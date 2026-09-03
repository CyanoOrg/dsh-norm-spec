import { dirname } from "node:path";

/**
 * Project one successful file-tool execution into the convention target:
 * the directory whose inherited conventions apply.
 *
 * DSH rc.6 file tools carry `file_path` in their raw arguments (D013);
 * `path` is accepted only as a harmless alias. Every tracked tool resolves
 * to the parent directory: upstream `norm collect` treats a file target as
 * its parent directory, so directory normalization is information-
 * preserving and avoids digest churn from the target string embedded in
 * the prompt projection.
 */
export function projectConventionTarget(
  toolName: string,
  input: unknown,
): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const record = input as Record<string, unknown>;
  const raw = record.file_path ?? record.path;
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  switch (toolName) {
    case "read":
    case "edit":
    case "write":
      return dirname(raw);
    default:
      return undefined;
  }
}
