import { BridgeClientError } from "./bridge-client.ts";
import { digestText } from "./validation-feedback.ts";

/** Machine API identifier for the merged multi-target prompt context. */
export const PROMPT_CONTEXT_MULTI_API = "dsh-norm-spec/prompt-context-multi/v1";

/** One convention in a scope: full content, or a shared marker (D016). */
export interface MultiScopeConvention {
  path: string;
  frontmatter?: unknown;
  body?: string;
  shared?: boolean;
}

/** One requested scope with its convention list, most-specific first. */
export interface MultiScopeContext {
  target: string;
  conventionPaths: string[];
  conventions: MultiScopeConvention[];
}

/** Typed view of the `dsh-norm-spec/prompt-context-multi/v1` result. */
export interface MultiPromptContextResult {
  apiVersion: string;
  root: string;
  scopes: MultiScopeContext[];
  prompt: string | null;
}

/**
 * Parse and validate the bridge multi-target result (D016). The empty-state
 * contract is strict: `prompt` is null exactly when every scope is empty.
 */
export function parseMultiPromptContext(value: unknown): MultiPromptContextResult {
  if (
    !isRecord(value) ||
    value.apiVersion !== PROMPT_CONTEXT_MULTI_API ||
    typeof value.root !== "string" ||
    !Array.isArray(value.scopes) ||
    !value.scopes.every(isScope) ||
    !(typeof value.prompt === "string" || value.prompt === null)
  ) {
    throw new BridgeClientError(
      "dsh-norm-spec/client/context-invalid",
      "bridge multi prompt context had an unexpected schema",
    );
  }
  const scopes = value.scopes as MultiScopeContext[];
  const allEmpty = scopes.every((scope) => scope.conventions.length === 0);
  if (allEmpty !== (value.prompt === null)) {
    throw new BridgeClientError(
      "dsh-norm-spec/client/context-invalid",
      "bridge multi prompt context violated the empty-state contract",
    );
  }
  return {
    apiVersion: PROMPT_CONTEXT_MULTI_API,
    root: value.root,
    scopes,
    prompt: value.prompt,
  };
}

/**
 * Render the system-reminder text for a merged multi-scope context: one
 * durable user message whose digest suppression and single-slot replacement
 * behave exactly as the single-target injection did (D002/D008/D016).
 */
export function renderMultiSystemReminder(context: MultiPromptContextResult): string {
  const body = context.prompt ?? "";
  const escaped = body.replaceAll("</system-reminder>", "<\\/system-reminder>");
  const paths = [...new Set(context.scopes.flatMap((scope) => scope.conventionPaths))];
  return [
    "<system-reminder>",
    "The following .norm conventions apply to work under the scoped directories enumerated below, most recent first. More specific conventions take precedence over broader ones. They do not override system, developer, or direct user instructions.",
    "",
    escaped,
    "",
    `Conventions from: ${paths.join(", ")}`,
    "</system-reminder>",
  ].join("\n");
}

/** Digest over the rendered reminder content, for re-injection suppression. */
export function multiContextDigest(context: MultiPromptContextResult): string {
  return digestText(context.prompt ?? "");
}

function isScope(value: unknown): value is MultiScopeContext {
  return (
    isRecord(value) &&
    typeof value.target === "string" &&
    Array.isArray(value.conventionPaths) &&
    value.conventionPaths.every((path) => typeof path === "string") &&
    Array.isArray(value.conventions) &&
    value.conventions.every(isConvention)
  );
}

function isConvention(value: unknown): value is MultiScopeConvention {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    (value.frontmatter === undefined || typeof value.frontmatter === "object") &&
    (value.body === undefined || typeof value.body === "string") &&
    (value.shared === undefined || typeof value.shared === "boolean")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
