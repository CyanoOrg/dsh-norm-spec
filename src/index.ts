/**
 * dsh-norm-spec — DeepSeek Harness Cordis plugin for norm-spec conventions.
 *
 * Session-scoped convention injection at `agent/pre-step` and soft post-edit
 * validation through `tools/post-execute`, both backed by one persistent
 * `dsh-norm-bridge` child per agent session. The TypeScript layer stays thin:
 * event registration, input projection, bridge calls, and user-visible text.
 * Format semantics live in the upstream norm-spec engine (D002/D006 in
 * docs/decisions.md).
 *
 * @module dsh-norm-spec
 */
import { relative } from "node:path";

import type { Context } from "@deepseek-ai/cordis";
import type { AssembleContext } from "@deepseek-ai/dsh-system-prompt";
import type { Agent, PreStepDecision } from "@deepseek-ai/dsh-agent";
import type { Session } from "@deepseek-ai/dsh-session";
import type { PostToolDecision, ToolExecution, ToolExecutionResult } from "@deepseek-ai/dsh-tools";
import { createUserMessage, type UserMessage } from "@deepseek-ai/dsh-llm";

import {
  BridgeClient,
  BridgeClientError,
  BridgeRequestCancelledError,
  type BridgeLaunch,
} from "./bridge-client.ts";
import {
  normCollectTool,
  normScanTool,
  normValidateTool,
  type ClientResolver,
} from "./native-tools.ts";
import {
  digestText,
  parseValidationResponse,
  presentValidation,
  presentValidationFailure,
  shouldValidateAfterTool,
} from "./validation-feedback.ts";
import { loadSkillRegistration } from "./skill-registration.ts";
import { parseLayoutIndex } from "./layout-index.ts";
import {
  multiContextDigest,
  parseMultiPromptContext,
  renderMultiSystemReminder,
  type MultiPromptContextResult,
} from "./multi-prompt-context.ts";
import { projectConventionTarget, pushTarget } from "./target-tracking.ts";
import {
  hostSessionEvents,
  isOwnReminderSource,
  onAgentSessionStart,
  pluginReminderSource,
  replaceSurfaceOp,
} from "./host-compat.ts";

const PLUGIN_NAME = "dsh-norm-spec";
const INCOMPLETE_BEHAVIOR = "enforcement is not implemented";
const SOURCE_KIND = "dsh-norm-spec-context";

/** Cordis plugin name used by loader diagnostics. */
export const name = "dsh-norm-spec";
/** Services required by this plugin (tool registration, skill registry, prompt section). */
export const inject = ["tools", "skills", "systemPrompt"];

/** Registry name of the adapter's system-prompt layout-index section (D015). */
export const LAYOUT_SECTION_NAME = "dsh-norm-spec:layout-index";
/** Tool-guidance band (100–199) so the map renders after tool docs. */
export const LAYOUT_SECTION_ORDER = 150;

export interface Config {
  /** Explicit launch for the bundled bridge; defaults to the packaged runtime. */
  launch?: BridgeLaunch;
  /**
   * Idle TTL before a session/ambient bridge reaps itself (D019).
   * Defaults to 10 minutes; 0 disables recycling.
   */
  bridgeIdleTtlMs?: number;
}

/** Default bridge idle TTL (D019): reaps quiet sessions' bridges. */
const DEFAULT_BRIDGE_IDLE_TTL_MS = 600_000;

/** This session's own layout snapshot (D018). */
interface LayoutSnapshot {
  /** Engine-rendered prompt; empty until the first refresh lands. */
  text: string;
  /** Root-relative declaring dirs, for the D015 first-touch measurement. */
  entryPaths: Set<string>;
}

interface SessionState {
  client: BridgeClient | undefined;
  failure: BridgeClientError | undefined;
  lastDigest: string | undefined;
  lastContext: MultiPromptContextResult | undefined;
  /** Bounded recency set of convention targets; index 0 is most recent (D016). */
  activeTargets: string[];
  onboardingNotified: boolean;
  validationFailure: BridgeClientError | undefined;
  validationTail: Promise<void>;
  disposed: boolean;
  starting: Promise<void> | undefined;
  layoutIndexDigest: string | undefined;
  layoutIndexStale: boolean;
  visitedTargets: Set<string>;
  /** Current agent object for this session — the assembly scope key (D018). */
  scopeAgent: object | undefined;
  /** This session's layout snapshot; undefined until first refresh (D018). */
  layout: LayoutSnapshot | undefined;
  /** Armed idle-reap timer handle; undefined when disarmed (D019). */
  idleTimer: ReturnType<typeof setTimeout> | undefined;
  /** Open bridge leases: native tools and plugin-issued requests (D019). */
  idleLeases: number;
  /** Queued-but-not-settled validation-tail items (D019). */
  idleQueued: number;
}

/**
 * Install the dsh-norm-spec adapter: bridge lifecycle, convention injection,
 * post-edit validation, and the norm native tools.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function apply(ctx: Context, config: Config = {}): void {
  const sessions = new WeakMap<object, SessionState>();

  // Layout-index provider index (D018): the assembly scope key — the agent
  // object itself on both host lines — resolves to that session's own
  // state. Replaces the D015 plugin-level singletons that served one
  // session's map to every session in a multi-session host.
  const stateByScopeAgent = new WeakMap<object, SessionState>();

  // Plugin-level fallback bridge for agent-less tool calls (Code Mode,
  // harnesses, direct registry consumers). Agent sessions keep their own
  // bridge so session lifecycle stays observable.
  let ambientState: SessionState | undefined;
  let ambientStarting: Promise<void> | undefined;

  const stateFor = (agent: Agent): SessionState => {
    let state = sessions.get(agent.session);
    if (state === undefined) {
      state = {
        client: undefined,
        failure: undefined,
        lastDigest: undefined,
        lastContext: undefined,
        activeTargets: ["."],
        onboardingNotified: false,
        validationFailure: undefined,
        validationTail: Promise.resolve(),
        disposed: false,
        starting: undefined,
        layoutIndexDigest: undefined,
        layoutIndexStale: false,
        visitedTargets: new Set(["."]),
        scopeAgent: agent,
        layout: undefined,
        idleTimer: undefined,
        idleLeases: 0,
        idleQueued: 0,
      };
      sessions.set(agent.session, state);
    } else if (state.scopeAgent !== agent) {
      // Same session object, fresh agent object (resume/clear/compaction on
      // a resident session): re-key the provider index and force one
      // re-fetch. The snapshot lives on the state, so the provider serves
      // the same session's correct map through the new key without a gap —
      // same session ⇒ same root ⇒ same map (D018).
      state.scopeAgent = agent;
      state.layoutIndexStale = true;
    }
    stateByScopeAgent.set(agent, state);
    return state;
  };

  const bridgeIdleTtlMs = config.bridgeIdleTtlMs ?? DEFAULT_BRIDGE_IDLE_TTL_MS;

  /** Arm (or re-arm) this state's idle-reap timer; slides on activity (D019). */
  const armIdleTimer = (state: SessionState): void => {
    if (state.idleTimer !== undefined) clearTimeout(state.idleTimer);
    state.idleTimer = undefined;
    if (state.disposed || bridgeIdleTtlMs <= 0) return;
    const timer = setTimeout(() => void reapIfIdle(state), bridgeIdleTtlMs);
    timer.unref();
    state.idleTimer = timer;
  };

  const noteActivity = (state: SessionState): void => {
    armIdleTimer(state);
  };

  /** Whether any work holds this state's bridge: startup, leases, or queued validation (D019). */
  const busy = (state: SessionState): boolean =>
    state.starting !== undefined || state.idleLeases > 0 || state.idleQueued > 0;

  const reapIfIdle = async (state: SessionState): Promise<void> => {
    state.idleTimer = undefined;
    if (state.disposed || state.client === undefined) return;
    if (busy(state)) {
      armIdleTimer(state);
      return;
    }
    // Detach first so new callers lazily restart while the old client
    // shuts down; disposed stays false — that flag is permanent disposal.
    const client = state.client;
    state.client = undefined;
    if (client.getStatus().state !== "failed") {
      await client.shutdown().catch(() => undefined);
    }
  };

  const acquireLease = (state: SessionState): void => {
    state.idleLeases += 1;
  };

  /** Idempotent lease release; always re-arms the idle timer (D019). */
  const releaseLease = (state: SessionState): void => {
    if (state.idleLeases > 0) state.idleLeases -= 1;
    noteActivity(state);
  };

  /** Run one plugin-issued bridge request under a lease so busy() sees it (D019). */
  const withLease = async <T>(state: SessionState, run: () => Promise<T>): Promise<T> => {
    acquireLease(state);
    try {
      return await run();
    } finally {
      releaseLease(state);
    }
  };

  const startBridgeFor = (state: SessionState): Promise<void> => {
    if (state.disposed || state.client !== undefined) return Promise.resolve();
    if (state.starting === undefined) {
      state.starting = (async () => {
        try {
          const launch = config.launch ?? (await defaultLaunch());
          const client = await BridgeClient.start({
            ...launch,
            onFailure: (failure) => {
              if (!state.disposed) state.failure = failure;
            },
          });
          if (state.disposed) {
            await client.shutdown();
            return;
          }
          state.client = client;
          state.failure = undefined;
        } catch (error) {
          if (!state.disposed) state.failure = asBridgeError(error);
        } finally {
          state.starting = undefined;
          noteActivity(state);
        }
      })();
    }
    return state.starting;
  };

  const startBridge = async (agent: Agent): Promise<void> => {
    await startBridgeFor(stateFor(agent));
  };

  const ambientBridge = async (): Promise<SessionState> => {
    if (ambientState === undefined) {
      ambientState = {
        client: undefined,
        failure: undefined,
        lastDigest: undefined,
        lastContext: undefined,
        activeTargets: ["."],
        onboardingNotified: false,
        validationFailure: undefined,
        validationTail: Promise.resolve(),
        disposed: false,
        starting: undefined,
        layoutIndexDigest: undefined,
        layoutIndexStale: false,
        visitedTargets: new Set(["."]),
        scopeAgent: undefined,
        layout: undefined,
        idleTimer: undefined,
        idleLeases: 0,
        idleQueued: 0,
      };
      ctx.effect(() => () => {
        const state = ambientState;
        ambientState = undefined;
        ambientStarting = undefined;
        if (state !== undefined) {
          state.disposed = true;
          if (state.idleTimer !== undefined) clearTimeout(state.idleTimer);
          state.idleTimer = undefined;
          const client = state.client;
          state.client = undefined;
          if (client !== undefined && client.getStatus().state !== "failed") {
            void client.shutdown().catch(() => undefined);
          }
        }
      }, `${PLUGIN_NAME}.ambient`);
    }
    if (ambientState.client === undefined && ambientStarting === undefined) {
      ambientStarting = startBridgeFor(ambientState).finally(() => {
        ambientStarting = undefined;
      });
    }
    await ambientStarting;
    return ambientState;
  };

  const stopBridge = async (agent: Agent): Promise<void> => {
    const state = stateFor(agent);
    state.disposed = true;
    if (state.idleTimer !== undefined) clearTimeout(state.idleTimer);
    state.idleTimer = undefined;
    state.validationTail = Promise.resolve();
    const client = state.client;
    state.client = undefined;
    if (client !== undefined && client.getStatus().state !== "failed") {
      await client.shutdown().catch(() => undefined);
    }
  };

  /** Locate the current convention slot on the session surface (D008). */
  const findConventionSlot = (session: Session) => {
    const surface = new Set<number>(session.surface.nodes);
    const events = hostSessionEvents(session);
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (event === undefined || event.type !== "user/message") continue;
      if (!isOwnReminderSource(event.data.source, PLUGIN_NAME)) continue;
      if (surface.has(event.seq)) {
        return { seq: event.seq, text: reminderTextOf(event.data) };
      }
      // An own message shadowed off the surface (compaction) ends the scan:
      // a later replacement is impossible and a fresh slot may append.
      return null;
    }
    return undefined;
  };

  const reminderTextOf = (message: UserMessage): string => {
    const first = message.content[0];
    return first !== undefined && first.type === "text" ? first.text : "";
  };

  /** Refresh the layout-index cache; a failure never blocks the step (D015). */
  const refreshLayoutIndex = async (
    state: SessionState,
    client: BridgeClient,
    cwd: string,
    signal: AbortSignal,
  ): Promise<void> => {
    if (!state.layoutIndexStale && state.layoutIndexDigest !== undefined) return;
    try {
      const value = await withLease(state, () =>
        client.request<unknown>("layoutIndex", { root: cwd }, signal));
      const index = parseLayoutIndex(value);
      const digest = digestText(index.prompt ?? "");
      const changed = digest !== state.layoutIndexDigest;
      state.layoutIndexDigest = digest;
      state.layoutIndexStale = false;
      if (!changed) return;
      state.layout = {
        text: index.prompt ?? "",
        entryPaths: new Set(index.entries.map((entry) => entry.path)),
      };
    } catch (error) {
      if (error instanceof BridgeRequestCancelledError) return;
      state.failure = asBridgeError(error);
    }
  };

  const injectContext = async (
    agent: Agent,
    messages: UserMessage[],
    signal: AbortSignal,
    next: () => Promise<PreStepDecision>,
  ): Promise<PreStepDecision> => {
    const decision = await next();
    if (decision.kind !== "enter") return decision;
    const state = stateFor(agent);
    // Ensure the bridge is up before the first injection: session-start
    // kicked it off, but pre-step may win the race on fast first steps.
    await startBridgeFor(state);
    const cwd = agent.session.header.cwd ?? process.cwd();
    const client = state.client;
    if (client === undefined || client.getStatus().state !== "ready") {
      return decision;
    }
    await refreshLayoutIndex(state, client, cwd, signal);

    try {
      const value = await withLease(state, () =>
        client.request<unknown>(
          "promptContextMulti",
          { root: cwd, targets: state.activeTargets },
          signal,
        ));
      const context = parseMultiPromptContext(value);
      state.lastContext = context;
      if (context.prompt === null) {
        notifyOnboarding(state);
        return decision;
      }
      const digest = multiContextDigest(context);
      if (digest === state.lastDigest) return decision;

      const reminder = renderMultiSystemReminder(context);
      const slot = findConventionSlot(agent.session);
      if (slot !== null && slot !== undefined) {
        if (slot.text === reminder) {
          state.lastDigest = digest;
          return decision;
        }
        // Single-slot replacement (D008): shadow the previous reminder in
        // place through a session surface replace; the step's claimed
        // messages stay untouched, so no splice into decision.messages.
        agent.session.append(
          "user/message",
          createUserMessage({
            content: [{ type: "text", text: reminder }],
            source: pluginReminderSource(PLUGIN_NAME, "instructions"),
          }),
          {
            surfaceOp: replaceSurfaceOp(slot.seq),
            sourceEventSeqs: [slot.seq],
          },
        );
        state.lastDigest = digest;
        return decision;
      }
      state.lastDigest = digest;

      const message = createUserMessage({
        content: [{ type: "text", text: reminder }],
        source: pluginReminderSource(PLUGIN_NAME, "instructions"),
      });
      // Anchor the reminder after the step's last claimed message when the
      // identity match holds (rc.6 hands the same instances); on hosts where
      // the decision re-wraps messages in fresh instances the match is empty,
      // and a leading insert would be dropped at request assembly — append
      // at the end instead, the sanctioned plugin shape upstream tests use.
      const lastClaimedIndex = decision.messages.findLastIndex((m) => messages.includes(m));
      const insertAt = lastClaimedIndex >= 0
        ? lastClaimedIndex + 1
        : decision.messages.length;
      return {
        ...decision,
        messages: decision.messages.toSpliced(insertAt, 0, message),
      };
    } catch (error) {
      if (error instanceof BridgeRequestCancelledError) return decision;
      state.failure = asBridgeError(error);
      return decision;
    }
  };

  const validateAfterTool = async (
    agent: Agent,
    exec: ToolExecution,
    result: Readonly<ToolExecutionResult>,
    signal: AbortSignal,
    next: () => Promise<PostToolDecision>,
  ): Promise<PostToolDecision> => {
    const decision = await next();
    if (!shouldValidateAfterTool(String(exec.name), result.isError)) return decision;

    const state = stateFor(agent);
    // Editing a `.norm` file may change the declared layout; refresh the
    // system-prompt map on the next step (D015).
    const editedPath = inputFilePath(exec.arguments);
    if (editedPath !== undefined && (editedPath === ".norm" || editedPath.endsWith("/.norm"))) {
      state.layoutIndexStale = true;
    }
    const cwd = agent.session.header.cwd ?? process.cwd();
    const run = async (): Promise<PostToolDecision> => {
      // A mid-tool-call idle reap must not surface as a false validation
      // failure: restart lazily exactly like the pre-step path does (D019).
      await startBridgeFor(state);
      const client = state.client;
      if (client === undefined || client.getStatus().state !== "ready") {
        const failure =
          state.failure ??
          new BridgeClientError(
            "dsh-norm-spec/client/validation-unavailable",
            "the verified bridge is not ready for post-edit validation",
          );
        return appendFeedback(decision, presentValidationFailure(failure).text);
      }
      try {
        const value = await client.request<unknown>("validate", { root: cwd }, signal);
        const response = parseValidationResponse(value);
        state.validationFailure = undefined;
        const presentation = presentValidation(response);
        if (presentation.text === null) return decision;
        return appendFeedback(decision, presentation.text);
      } catch (error) {
        if (error instanceof BridgeRequestCancelledError) return decision;
        const failure = asBridgeError(error);
        state.validationFailure = failure;
        return appendFeedback(decision, presentValidationFailure(failure).text);
      }
    };
    // Counted at ENQUEUE so a reap can never fire between two FIFO tail
    // items; the paired decrement lives in the settled continuation (D019).
    state.idleQueued += 1;
    const settled = state.validationTail.then(run, run);
    state.validationTail = settled.then(
      () => {
        state.idleQueued -= 1;
        noteActivity(state);
      },
      () => {
        state.idleQueued -= 1;
        noteActivity(state);
      },
    );
    return settled;
  };

  ctx.effect(() => () => {
    // Cordis disposal: sessions tear down through agent/disposed below; this
    // effect only clears plugin-level resources (none beyond session maps).
  }, `${PLUGIN_NAME}.lifecycle`);

  onAgentSessionStart(ctx, ({ agent }) => {
    void startBridge(agent);
  });

  ctx.on("agent/disposed", ({ agent }) => {
    void stopBridge(agent);
  });

  // prepend: run as the outermost pre-step listener, the same shape the
  // official time-context plugin uses — an inner (later-registered) wrapper
  // observes the returned decision first and strips messages it does not
  // recognize, silently dropping the injected reminder on 0.2.0 hosts.
  ctx.on(
    "agent/pre-step",
    async ({ agent, messages, signal }, next) =>
      signal.aborted ? next() : injectContext(agent, messages, signal, next),
    { prepend: true },
  );

  ctx.on("tools/result", (exec, result) => {
    if (exec.agent === undefined || result.isError) return;
    const state = stateFor(exec.agent);
    updateActiveTargets(state, String(exec.name), exec.arguments);
    logFirstTouch(state, exec);
  });

  ctx.on("tools/post-execute", async (exec, result, next) => {
    if (exec.agent === undefined) return next();
    return validateAfterTool(exec.agent, exec, result, exec.signal, next);
  });

  const resolveToolClient: ClientResolver = async (exec) => {
    const agent = exec.agent;
    const state = agent !== undefined ? stateFor(agent) : await ambientBridge();
    if (agent !== undefined) await startBridge(agent);
    // Lease acquisition and the client read share one synchronous block —
    // no reap can slip between them; every throwing path below decrements
    // before throwing, because a stranded lease would pin busy() forever
    // and silently disable recycling (D019).
    state.idleLeases += 1;
    const client = state.client;
    if (client === undefined || client.getStatus().state !== "ready") {
      releaseLease(state);
      throw new BridgeClientError(
        "dsh-norm-spec/client/tool-unavailable",
        agent !== undefined
          ? "no ready session bridge for this tool call"
          : "no ready ambient bridge for this tool call",
      );
    }
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      releaseLease(state);
    };
    return { client, release };
  };

  ctx.tools.register(normValidateTool(resolveToolClient));
  ctx.tools.register(normCollectTool(resolveToolClient));
  ctx.tools.register(normScanTool(resolveToolClient));

  // Runtime Skill registration (D009): one dsh-specific Skill from the
  // package file. rank 250 — project roots override, uninstall removes.
  ctx.skills.register(loadSkillRegistration());

  // Layout-index section (D015 registration, D018 resolution): one
  // globally registered section whose provider resolves the assembly
  // scope — the agent object itself on both host lines — to that
  // session's own snapshot. Agent-less assemblies carry no map at all;
  // refreshes never re-register and a fresh session contributes nothing
  // until its first map lands. The provider is total (WeakMap.get +
  // optional chaining), satisfying the assembly's no-throw contract.
  ctx.systemPrompt.section({
    name: LAYOUT_SECTION_NAME,
    order: LAYOUT_SECTION_ORDER,
    text: (context: AssembleContext): string => {
      const scope = context.scope;
      if (scope === undefined) return "";
      return stateByScopeAgent.get(scope)?.layout?.text ?? "";
    },
  });

  /** D015 measurement: plugin-log only, never the session log. */
  function logFirstTouch(state: SessionState, exec: ToolExecution): void {
    const target = state.activeTargets[0] ?? ".";
    if (state.visitedTargets.has(target)) return;
    state.visitedTargets.add(target);
    const cwd = exec.agent?.session.header.cwd ?? process.cwd();
    const relativeTarget = relative(cwd, target) || ".";
    const declaresNorm = state.layout?.entryPaths.has(relativeTarget) ?? false;
    ctx.logger.debug(
      `dsh-norm-spec: first-touch tool=${String(exec.name)} dir=${relativeTarget} declaresNorm=${declaresNorm}`,
    );
  }
}

function updateActiveTargets(
  state: SessionState,
  toolName: string,
  input: unknown,
): void {
  const target = projectConventionTarget(toolName, input);
  if (target !== undefined) state.activeTargets = pushTarget(state.activeTargets, target);
}

/** Raw `file_path` argument, when the input carries one. */
function inputFilePath(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const raw = (input as Record<string, unknown>).file_path;
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

function appendFeedback(
  decision: PostToolDecision,
  text: string | null,
): PostToolDecision {
  if (decision.kind !== "accept" || text === null) return decision;
  if ("content" in decision && Array.isArray(decision.content)) {
    return { ...decision, content: [...decision.content, { type: "text", text }] } as PostToolDecision;
  }
  if ("value" in decision) {
    // value-form accept: model-visible content is derived from the value, so
    // additionalContexts carries the bounded feedback instead.
    return {
      ...decision,
      additionalContexts: [
        ...(decision.additionalContexts ?? []),
        createUserMessage({
          content: [{ type: "text", text }],
          source: pluginReminderSource(
            PLUGIN_NAME,
            "notice",
            "dsh-norm-spec post-edit validation feedback",
          ),
        }),
      ],
    };
  }
  return { ...decision, content: [{ type: "text", text }] } as PostToolDecision;
}

function notifyOnboarding(state: SessionState): void {
  if (state.onboardingNotified) return;
  state.onboardingNotified = true;
}

async function defaultLaunch(): Promise<BridgeLaunch> {
  const { resolvePlatformRuntime } = await import("./runtime-resolver.ts");
  return resolvePlatformRuntime();
}

function asBridgeError(error: unknown): BridgeClientError {
  return error instanceof BridgeClientError
    ? error
    : new BridgeClientError("dsh-norm-spec/client/startup-failed", errorMessage(error));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const STATUS_HINT = `${PLUGIN_NAME}: session-scoped .norm conventions; ${INCOMPLETE_BEHAVIOR}`;
export { SOURCE_KIND };
