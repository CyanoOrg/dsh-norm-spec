import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export const BRIDGE_API_VERSION = "dsh-norm-spec/bridge/v1";

const MAX_OUTPUT_FRAME_BYTES = 16 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000;

type JsonObject = Record<string, unknown>;
type ClientState = "starting" | "ready" | "stopping" | "stopped" | "failed";

export interface BridgeLaunch {
  command: string;
  args: readonly string[];
  cwd?: string;
}

export interface BridgeClientOptions extends BridgeLaunch {
  startupTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  onFailure?: (failure: BridgeClientError) => void;
}

export interface BridgeReadyIdentity {
  payload: JsonObject;
  compatibility: JsonObject;
}

export interface BridgeClientStatus {
  state: ClientState;
  ready?: BridgeReadyIdentity;
  failure?: BridgeClientError;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
}

export class BridgeClientError extends Error {
  readonly code: string;
  readonly path?: string;

  constructor(code: string, message: string, path?: string) {
    super(message);
    this.name = "BridgeClientError";
    this.code = code;
    this.path = path;
  }
}

export class BridgeRequestCancelledError extends Error {
  readonly requestId: string;

  constructor(requestId: string) {
    super(`bridge request was cancelled: ${requestId}`);
    this.name = "BridgeRequestCancelledError";
    this.requestId = requestId;
  }
}

export class BridgeClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly options: BridgeClientOptions;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly readyPromise: Promise<BridgeReadyIdentity>;
  private readonly closedPromise: Promise<void>;
  private resolveReady: (identity: BridgeReadyIdentity) => void = () => {};
  private rejectReady: (error: Error) => void = () => {};
  private resolveClosed: () => void = () => {};
  private state: ClientState = "starting";
  private readyIdentity: BridgeReadyIdentity | undefined;
  private failure: BridgeClientError | undefined;
  private stdoutBuffer = "";
  private stderr = "";
  private nextRequest = 0;
  private startupTimer: ReturnType<typeof setTimeout> | undefined;

  private constructor(options: BridgeClientOptions) {
    this.options = options;
    this.readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.closedPromise = new Promise((resolve) => {
      this.resolveClosed = resolve;
    });
    this.child = spawn(options.command, [...options.args], {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.attachProcessHandlers();
    this.startStartupTimer();
  }

  static async start(options: BridgeClientOptions): Promise<BridgeClient> {
    const client = new BridgeClient(options);
    await client.readyPromise;
    return client;
  }

  getStatus(): BridgeClientStatus {
    return {
      state: this.state,
      ready: this.readyIdentity,
      failure: this.failure,
    };
  }

  request<T>(method: string, params?: JsonObject, signal?: AbortSignal): Promise<T> {
    if (this.state !== "ready") {
      return Promise.reject(
        this.failure ??
          new BridgeClientError(
            "dsh-norm-spec/client/not-ready",
            `bridge is not ready: ${this.state}`,
          ),
      );
    }
    if (signal?.aborted) {
      return Promise.reject(new BridgeRequestCancelledError("not-sent"));
    }
    return this.sendRequest<T>(method, params, signal);
  }

  async shutdown(): Promise<void> {
    if (this.state === "stopped") return;
    if (this.state === "failed") {
      throw this.failure ?? new BridgeClientError("dsh-norm-spec/client/failed", "bridge failed");
    }
    if (this.state === "starting") {
      await this.readyPromise;
    }
    if (this.state !== "ready") return;

    const acknowledgement = this.sendRequest<void>("shutdown");
    this.state = "stopping";
    await acknowledgement;
    await withTimeout(
      this.closedPromise,
      this.options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS,
      () => {
        this.fail(
          new BridgeClientError(
            "dsh-norm-spec/client/shutdown-timeout",
            "bridge did not exit after acknowledging shutdown",
          ),
        );
      },
    );
    if (this.failure) throw this.failure;
  }

  private attachProcessHandlers(): void {
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.receiveStdout(chunk));
    this.child.stdout.on("end", () => this.handleStdoutEnd());
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => this.receiveStderr(chunk));
    this.child.on("error", (error) => {
      this.fail(
        new BridgeClientError(
          "dsh-norm-spec/client/spawn-failed",
          `bridge process could not be started: ${error.message}`,
        ),
      );
    });
    this.child.on("close", (code, signal) => this.handleClose(code, signal));
  }

  private startStartupTimer(): void {
    this.startupTimer = setTimeout(() => {
      this.fail(
        new BridgeClientError(
          "dsh-norm-spec/client/startup-timeout",
          "bridge did not emit ready before the startup timeout",
        ),
      );
    }, this.options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS);
    this.startupTimer.unref();
  }

  private receiveStdout(chunk: string): void {
    if (this.state === "failed" || this.state === "stopped") return;
    this.stdoutBuffer += chunk;
    if (Buffer.byteLength(this.stdoutBuffer, "utf8") > MAX_OUTPUT_FRAME_BYTES) {
      this.fail(
        new BridgeClientError(
          "dsh-norm-spec/client/output-too-large",
          "bridge output frame exceeded 16 MiB",
        ),
      );
      return;
    }
    let newline = this.stdoutBuffer.indexOf("\n");
    while (newline >= 0) {
      let line = this.stdoutBuffer.slice(0, newline);
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      this.receiveLine(line);
      if (this.failure !== undefined) return;
      newline = this.stdoutBuffer.indexOf("\n");
    }
  }

  private receiveLine(line: string): void {
    let frame: unknown;
    try {
      frame = JSON.parse(line);
    } catch (error) {
      this.fail(
        new BridgeClientError(
          "dsh-norm-spec/client/frame-invalid",
          `bridge emitted invalid JSON: ${errorMessage(error)}`,
        ),
      );
      return;
    }
    if (!isRecord(frame) || frame.apiVersion !== BRIDGE_API_VERSION) {
      this.fail(
        new BridgeClientError(
          "dsh-norm-spec/client/protocol-mismatch",
          "bridge emitted a frame with an unexpected API version",
        ),
      );
      return;
    }
    if (frame.type === "event") {
      this.receiveEvent(frame);
    } else if (frame.type === "response") {
      this.receiveResponse(frame);
    } else {
      this.fail(
        new BridgeClientError(
          "dsh-norm-spec/client/frame-invalid",
          "bridge emitted an unexpected frame type",
        ),
      );
    }
  }

  private receiveEvent(frame: JsonObject): void {
    if (frame.event === "ready") {
      if (this.state !== "starting" || !isRecord(frame.payload) || !isRecord(frame.compatibility)) {
        this.fail(
          new BridgeClientError(
            "dsh-norm-spec/client/ready-invalid",
            "bridge ready event was missing exact runtime identity",
          ),
        );
        return;
      }
      this.readyIdentity = { payload: frame.payload, compatibility: frame.compatibility };
      this.state = "ready";
      this.clearStartupTimer();
      this.resolveReady(this.readyIdentity);
      return;
    }
    if (frame.event === "startupFailed" || frame.event === "fatal") {
      this.fail(errorFromFrame(frame));
      return;
    }
    this.fail(
      new BridgeClientError(
        "dsh-norm-spec/client/event-unsupported",
        `bridge emitted an unsupported event: ${String(frame.event)}`,
      ),
    );
  }

  private receiveResponse(frame: JsonObject): void {
    if (typeof frame.id !== "string" || typeof frame.status !== "string") {
      this.fail(
        new BridgeClientError(
          "dsh-norm-spec/client/response-invalid",
          "bridge response omitted its ID or terminal status",
        ),
      );
      return;
    }
    const pending = this.pending.get(frame.id);
    if (!pending) {
      this.fail(
        new BridgeClientError(
          "dsh-norm-spec/client/response-unexpected",
          `bridge responded to an unknown request: ${frame.id}`,
        ),
      );
      return;
    }
    this.pending.delete(frame.id);
    pending.cleanup();
    if (frame.status === "ok") {
      pending.resolve(frame.result);
    } else if (frame.status === "cancelled") {
      pending.reject(new BridgeRequestCancelledError(frame.id));
    } else if (frame.status === "error") {
      const error = errorFromFrame(frame);
      pending.reject(error);
      if (error.code === "dsh-norm-spec/client/error-invalid") this.fail(error);
    } else {
      const error = new BridgeClientError(
        "dsh-norm-spec/client/response-invalid",
        `bridge returned an unsupported status: ${frame.status}`,
      );
      pending.reject(error);
      this.fail(error);
    }
  }

  private sendRequest<T>(method: string, params?: JsonObject, signal?: AbortSignal): Promise<T> {
    const id = `pi-${++this.nextRequest}`;
    const frame: JsonObject = {
      apiVersion: BRIDGE_API_VERSION,
      type: "request",
      id,
      method,
    };
    if (params !== undefined) frame.params = params;

    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        if (!this.pending.has(id) || this.state !== "ready") return;
        void this.sendRequest("cancel", { requestId: id }).catch(() => {});
      };
      if (signal) signal.addEventListener("abort", onAbort, { once: true });
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        cleanup: () => signal?.removeEventListener("abort", onAbort),
      });
      try {
        this.child.stdin.write(`${JSON.stringify(frame)}\n`, "utf8", (error) => {
          if (error) {
            this.fail(
              new BridgeClientError(
                "dsh-norm-spec/client/input-failed",
                `bridge request could not be written: ${error.message}`,
              ),
            );
          }
        });
      } catch (error) {
        this.fail(
          new BridgeClientError(
            "dsh-norm-spec/client/input-failed",
            `bridge request could not be written: ${errorMessage(error)}`,
          ),
        );
      }
    });
  }

  private receiveStderr(chunk: string): void {
    this.stderr = `${this.stderr}${chunk}`.slice(0, MAX_STDERR_BYTES);
    this.fail(
      new BridgeClientError(
        "dsh-norm-spec/client/unexpected-stderr",
        `bridge wrote to stderr: ${this.stderr.trim() || "unknown diagnostic"}`,
      ),
    );
  }

  private handleStdoutEnd(): void {
    if (this.stdoutBuffer.length > 0) {
      this.fail(
        new BridgeClientError(
          "dsh-norm-spec/client/frame-incomplete",
          "bridge output ended with an incomplete JSONL frame",
        ),
      );
      return;
    }
    if (this.state === "stopping" && this.pending.size === 0) return;
    if (this.state !== "failed" && this.state !== "stopped") {
      this.fail(
        new BridgeClientError(
          "dsh-norm-spec/client/output-closed",
          "bridge output closed unexpectedly",
        ),
      );
    }
  }

  private handleClose(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.state === "stopping" && code === 0 && this.pending.size === 0) {
      this.state = "stopped";
    } else if (this.state !== "failed" && this.state !== "stopped") {
      this.fail(
        new BridgeClientError(
          "dsh-norm-spec/client/crashed",
          `bridge exited unexpectedly with code ${String(code)} and signal ${String(signal)}`,
        ),
      );
    }
    this.resolveClosed();
  }

  private fail(failure: BridgeClientError): void {
    if (this.state === "failed" || this.state === "stopped") return;
    const wasStarting = this.state === "starting";
    this.state = "failed";
    this.failure = failure;
    this.clearStartupTimer();
    if (wasStarting) this.rejectReady(failure);
    for (const pending of this.pending.values()) {
      pending.cleanup();
      pending.reject(failure);
    }
    this.pending.clear();
    this.options.onFailure?.(failure);
    if (this.child.exitCode === null && !this.child.killed) {
      this.child.kill();
    }
  }

  private clearStartupTimer(): void {
    if (this.startupTimer !== undefined) {
      clearTimeout(this.startupTimer);
      this.startupTimer = undefined;
    }
  }
}

function errorFromFrame(frame: JsonObject): BridgeClientError {
  if (!isRecord(frame.error)) {
    return new BridgeClientError(
      "dsh-norm-spec/client/error-invalid",
      "bridge error frame omitted its typed error",
    );
  }
  const code = typeof frame.error.code === "string" ? frame.error.code : "dsh-norm-spec/client/error-invalid";
  const message = typeof frame.error.message === "string" ? frame.error.message : "bridge returned an invalid error";
  const path = typeof frame.error.path === "string" ? frame.error.path : undefined;
  return new BridgeClientError(code, message, path);
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function withTimeout(
  promise: Promise<void>,
  timeoutMs: number,
  onTimeout: () => void,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          onTimeout();
          resolve();
        }, timeoutMs);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
