import { BridgeClientError } from "./bridge-client.ts";

/** Machine API identifier for the bridge layout-index result. */
export const LAYOUT_INDEX_API = "dsh-norm-spec/layout-index/v1";

/** One declaring directory in the convention map. */
export interface LayoutIndexEntry {
  /** Root-relative directory path as reported by the scan. */
  path: string;
  /** Frontmatter `metadata.description` when the collected `.norm` has one. */
  description: string | null;
}

/** Typed view of the `dsh-norm-spec/layout-index/v1` result. */
export interface LayoutIndex {
  apiVersion: string;
  root: string;
  entries: LayoutIndexEntry[];
  prompt: string | null;
}

/**
 * Parse and validate the bridge layout-index result (D015). An empty map is
 * typed as `prompt: null` with no entries; the section then contributes
 * nothing rather than fabricating content.
 */
export function parseLayoutIndex(value: unknown): LayoutIndex {
  if (
    !isRecord(value) ||
    value.apiVersion !== LAYOUT_INDEX_API ||
    typeof value.root !== "string" ||
    !Array.isArray(value.entries) ||
    !value.entries.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.path === "string" &&
        (entry.description === null || typeof entry.description === "string"),
    ) ||
    !(typeof value.prompt === "string" || value.prompt === null)
  ) {
    throw new BridgeClientError(
      "dsh-norm-spec/client/layout-invalid",
      "bridge layout index had an unexpected schema",
    );
  }
  return {
    apiVersion: LAYOUT_INDEX_API,
    root: value.root,
    entries: value.entries.map((entry) => ({
      path: entry.path,
      description: entry.description,
    })),
    prompt: value.prompt,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
