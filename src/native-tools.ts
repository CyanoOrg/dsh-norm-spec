/**
 * Native norm tools registered on `ctx.tools`.
 *
 * Each tool delegates to the session-scoped bridge and returns a bounded
 * canonical JSON value; no `.norm` parsing happens in TypeScript.
 *
 * @module dsh-norm-spec/native-tools
 */
import type { ToolDefinition, ToolRunContext } from "@deepseek-ai/dsh-tools";

import type { BridgeClient } from "./bridge-client.ts";
import { BridgeClientError } from "./bridge-client.ts";
import { parseValidationResponse, type ValidationResponse } from "./validation-feedback.ts";

const MAX_TOOL_TEXT_BYTES = 16 * 1024;

/** Adapter callback resolving the bridge client for one invocation. */
export type ClientResolver = (exec: ToolRunContext) => Promise<BridgeClient>;

interface ValidateValue {
  ok: boolean;
  root: string;
  files: number;
  errors: number;
  warnings: number;
  report: string;
  findings: Array<{
    path: string;
    severity: "error" | "warning";
    code: string;
    message: string;
    field: string | null;
    suggestion: string | null;
  }>;
}

interface CollectValue {
  ok: boolean;
  target: string;
  conventionPaths: string[];
  prompt: string | null;
}

interface ScanValue {
  ok: boolean;
  error: string | null;
  report: string;
  conventionPaths: string[];
}

interface ScanValue {
  ok: boolean;
  error: string | null;
  report: string;
}

function sessionRoot(exec: ToolRunContext): string {
  return exec.agent?.session.header.cwd ?? process.cwd();
}

async function withClient<T>(
  resolve: ClientResolver,
  exec: ToolRunContext,
  run: (client: BridgeClient) => Promise<T>,
): Promise<T> {
  const client = await resolve(exec);
  if (client.getStatus().state !== "ready") {
    throw new BridgeClientError(
      "dsh-norm-spec/client/tool-unavailable",
      "the verified bridge is not ready",
    );
  }
  return run(client);
}

function renderText(lines: string[]): string {
  return boundText(lines.join("\n"));
}

function boundText(value: string): string {
  if (Buffer.byteLength(value, "utf8") <= MAX_TOOL_TEXT_BYTES) return value;
  return `${value.slice(0, MAX_TOOL_TEXT_BYTES)}\n... truncated`;
}

function toolError(error: unknown): { ok: false; error: string; report: string } {
  const message = error instanceof Error ? error.message : String(error);
  return { ok: false, error: message, report: `dsh-norm-spec tool failed: ${message}` };
}

/** `norm_validate`: strict whole-project `.norm` validation. */
export function normValidateTool(resolve: ClientResolver): ToolDefinition {
  return {
    name: "norm_validate",
    description:
      "Validate every .norm file under the session project root with the canonical norm-spec engine (strict mode). Returns a per-file findings summary.",
    parameters: {
      type: "object",
      properties: {},
    },
    output: {
      schema: { type: "object" },
      render: (_args: unknown, value: unknown) => [
        {
          type: "text",
          text: typeof (value as ValidateValue)?.report === "string"
            ? (value as ValidateValue).report
            : String(value),
        },
      ],
    },
    async execute(_args: unknown, exec: ToolRunContext): Promise<unknown> {
      try {
        return await withClient(resolve, exec, async (client) => {
          const raw = await client.request<unknown>(
            "validate",
            { root: sessionRoot(exec) },
            exec.signal,
          );
          const response: ValidationResponse = parseValidationResponse(raw);
          return toValidateValue(response);
        });
      } catch (error) {
        return toolError(error);
      }
    },
  } as ToolDefinition;
}

function toValidateValue(response: ValidationResponse): ValidateValue {
  const findings: ValidateValue["findings"] = [];
  for (const result of response.results) {
    for (const [severity, list] of [
      ["error", result.errors],
      ["warning", result.warnings],
    ] as const) {
      for (const finding of list) {
        findings.push({
          path: result.path,
          severity,
          code: finding.code,
          message: finding.message,
          field: finding.field,
          suggestion: finding.suggestion,
        });
      }
    }
  }
  const { files, errors, warnings } = response.summary;
  const report = renderText([
    `norm validate --all --strict @ ${response.root}`,
    `${files} .norm files: ${errors} errors, ${warnings} warnings`,
    ...findings.slice(0, 20).map(
      (f) =>
        `- ${f.severity.toUpperCase()} ${f.path} [${f.code}]${f.field === null ? "" : ` field=${f.field}`}: ${f.message}${f.suggestion === null ? "" : ` Fix: ${f.suggestion}`}`,
    ),
    ...(findings.length > 20 ? [`... ${findings.length - 20} more findings omitted`] : []),
  ]);
  return { ok: errors === 0, root: response.root, files, errors, warnings, findings, report };
}

/** `norm_collect`: show the collected conventions for one target path. */
export function normCollectTool(resolve: ClientResolver): ToolDefinition {
  return {
    name: "norm_collect",
    description:
      "Collect the .norm conventions that apply to a target path (default: the session root) and return the normalized prompt context.",
    parameters: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "Project-relative target path to collect for.",
        },
      },
    },
    output: {
      schema: { type: "object" },
      render: (_args: unknown, value: unknown) => [
        {
          type: "text",
          text: typeof (value as CollectValue)?.prompt === "string"
            ? (value as CollectValue).prompt
            : JSON.stringify(value),
        },
      ],
    },
    async execute(args: unknown, exec: ToolRunContext): Promise<unknown> {
      const target =
        typeof (args as { target?: unknown })?.target === "string" &&
        (args as { target: string }).target.length > 0
          ? (args as { target: string }).target
          : sessionRoot(exec);
      try {
        return await withClient(resolve, exec, async (client) => {
          const raw = await client.request<unknown>(
            "promptContext",
            { root: sessionRoot(exec), target },
            exec.signal,
          );
          const context = raw as CollectValue;
          return {
            ok: true,
            target: context.target,
            conventionPaths: context.conventionPaths,
            prompt: context.prompt === null ? null : boundText(context.prompt),
          };
        });
      } catch (error) {
        return toolError(error);
      }
    },
  } as ToolDefinition;
}

/** `norm_scan`: report `.norm` coverage under the session root. */
export function normScanTool(resolve: ClientResolver): ToolDefinition {
  return {
    name: "norm_scan",
    description:
      "Scan the session project for .norm files and report which directories declare conventions.",
    parameters: {
      type: "object",
      properties: {},
    },
    output: {
      schema: { type: "object" },
      render: (_args: unknown, value: unknown) => [
        {
          type: "text",
          text: typeof (value as ScanValue)?.report === "string"
            ? (value as ScanValue).report
            : String(value),
        },
      ],
    },
    async execute(_args: unknown, exec: ToolRunContext): Promise<unknown> {
      try {
        return await withClient(resolve, exec, async (client) => {
          const raw = await client.request<unknown>(
            "collect",
            { root: sessionRoot(exec), target: sessionRoot(exec) },
            exec.signal,
          );
          const paths = Array.isArray((raw as { conventionPaths?: unknown })?.conventionPaths)
            ? ((raw as { conventionPaths: string[] }).conventionPaths)
            : [];
          const report = renderText([
            `norm scan @ ${sessionRoot(exec)}`,
            paths.length === 0
              ? "No .norm conventions found."
              : `${paths.length} convention file(s):`,
            ...paths.map((p) => `- ${p}`),
          ]);
          return { ok: true, error: null, report, conventionPaths: paths };
        });
      } catch (error) {
        const base = toolError(error);
        return { ...base, conventionPaths: [] };
      }
    },
  } as ToolDefinition;
}
