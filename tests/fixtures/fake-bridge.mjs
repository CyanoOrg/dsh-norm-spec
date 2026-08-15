import { createInterface } from "node:readline";

const apiVersion = "dsh-norm-spec/bridge/v1";
const mode = process.argv[2] ?? "ready";
const emit = (frame) => process.stdout.write(`${JSON.stringify(frame)}\n`);

function validationResult(selectedMode, sequence = 1) {
  if (selectedMode === "validate-findings") {
    return {
      apiVersion: "norm-spec/validate/v1",
      root: ".",
      results: [
        {
          path: ".norm",
          status: "warning",
          errors: [],
          warnings: [
            {
              code: "norm-spec/test-warning",
              message: "a test warning",
              field: "metadata.description",
              suggestion: "add a clearer description",
            },
          ],
        },
        {
          path: "docs/.norm",
          status: "error",
          errors: [
            {
              code: "norm-spec/test-error",
              message: "a test error",
              field: null,
              suggestion: "repair the convention",
            },
          ],
          warnings: [],
        },
      ],
      summary: { files: 2, errors: 1, warnings: 1 },
    };
  }
  if (selectedMode === "validate-many-findings") {
    const errors = Array.from({ length: 12 }, (_, index) => ({
      code: `norm-spec/test-${index + 1}`,
      message: `diagnostic ${index + 1} ${"x".repeat(2000)}`,
      field: null,
      suggestion: "repair the convention",
    }));
    return {
      apiVersion: "norm-spec/validate/v1",
      root: ".",
      results: [{ path: ".norm", status: "error", errors, warnings: [] }],
      summary: { files: 1, errors: errors.length, warnings: 0 },
    };
  }
  if (selectedMode === "validate-serial") {
    return {
      apiVersion: "norm-spec/validate/v1",
      root: ".",
      results: [
        {
          path: ".norm",
          status: "warning",
          errors: [],
          warnings: [
            {
              code: `fake/serial-${sequence}`,
              message: `serialized validation ${sequence}`,
              field: null,
              suggestion: null,
            },
          ],
        },
      ],
      summary: { files: 1, errors: 0, warnings: 1 },
    };
  }
  return {
    apiVersion: "norm-spec/validate/v1",
    root: ".",
    results: [
      { path: ".norm", status: "ok", errors: [], warnings: [] },
      { path: "docs/.norm", status: "ok", errors: [], warnings: [] },
    ],
    summary: { files: 2, errors: 0, warnings: 0 },
  };
}

if (mode === "startup-failure") {
  emit({
    apiVersion,
    type: "event",
    event: "startupFailed",
    error: { code: "fake/startup", message: "fake startup failure", path: null },
  });
  process.exitCode = 1;
} else if (mode === "malformed") {
  process.stdout.write("{not-json}\n");
} else {
  emit({
    apiVersion,
    type: "event",
    event: "ready",
    payload: { tag: "v0.1.0-rc.1", target: "test-target" },
    compatibility: { apiVersion: "norm-spec/compatibility/v1" },
  });
  if (mode === "crash-after-ready") {
    setTimeout(() => process.exit(19), 20);
  }

  let active;
  let promptContextRequests = 0;
  let validateRequests = 0;
  const lines = createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    const request = JSON.parse(line);
    if (request.method === "status") {
      emit({ apiVersion, type: "response", id: request.id, status: "ok", result: { healthy: true } });
    } else if (request.method === "promptContext" && mode === "context-error") {
      emit({
        apiVersion,
        type: "response",
        id: request.id,
        status: "error",
        error: { code: "fake/context", message: "fake context failure", path: request.params.target },
      });
    } else if (request.method === "promptContext" && mode === "context-error-once" && promptContextRequests++ === 0) {
      emit({
        apiVersion,
        type: "response",
        id: request.id,
        status: "error",
        error: { code: "fake/context", message: "fake context failure", path: request.params.target },
      });
    } else if (request.method === "promptContext" && mode === "cancel") {
      active = request.id;
    } else if (request.method === "promptContext") {
      const target = request.params.target;
      const empty = mode === "empty-context";
      emit({
        apiVersion,
        type: "response",
        id: request.id,
        status: "ok",
        result: {
          apiVersion: "dsh-norm-spec/prompt-context/v1",
          target,
          conventionPaths: empty ? [] : target.startsWith("docs") ? ["docs/.norm", ".norm"] : [".norm"],
          prompt: empty ? null : `PI_NORM_SPEC_CONTEXT_V1\ntarget=${target}\nEND_PI_NORM_SPEC_CONTEXT_V1`,
        },
      });
    } else if (request.method === "validate" && mode === "validate-error") {
      emit({
        apiVersion,
        type: "response",
        id: request.id,
        status: "error",
        error: { code: "fake/validation", message: "fake validation failure", path: request.params.root },
      });
    } else if (request.method === "validate" && mode === "validate-invalid") {
      emit({
        apiVersion,
        type: "response",
        id: request.id,
        status: "ok",
        result: { apiVersion: "norm-spec/validate/v1", root: ".", results: [], summary: { files: 1, errors: 0, warnings: 0 } },
      });
    } else if (request.method === "validate" && mode === "validate-cancel") {
      active = request.id;
    } else if (request.method === "validate" && mode === "validate-serial") {
      if (active) {
        emit({
          apiVersion,
          type: "response",
          id: request.id,
          status: "error",
          error: { code: "fake/busy", message: "concurrent validation", path: null },
        });
      } else {
        active = request.id;
        const sequence = ++validateRequests;
        setTimeout(() => {
          if (active !== request.id) return;
          emit({ apiVersion, type: "response", id: request.id, status: "ok", result: validationResult(mode, sequence) });
          active = undefined;
        }, 20);
      }
    } else if (request.method === "validate") {
      validateRequests += 1;
      emit({ apiVersion, type: "response", id: request.id, status: "ok", result: validationResult(mode, validateRequests) });
    } else if (request.method === "collect" && mode === "crash") {
      process.exit(17);
    } else if (request.method === "collect") {
      active = request.id;
    } else if (request.method === "cancel") {
      emit({
        apiVersion,
        type: "response",
        id: request.id,
        status: "ok",
        result: { requestId: request.params.requestId, accepted: request.params.requestId === active },
      });
      if (request.params.requestId === active) {
        emit({ apiVersion, type: "response", id: active, status: "cancelled" });
        active = undefined;
      }
    } else if (request.method === "shutdown") {
      if (active) {
        emit({ apiVersion, type: "response", id: active, status: "cancelled" });
        active = undefined;
      }
      emit({ apiVersion, type: "response", id: request.id, status: "ok" });
      setImmediate(() => process.exit(0));
    }
  });
}
