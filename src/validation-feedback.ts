import { createHash } from "node:crypto";

import { BridgeClientError } from "./bridge-client.ts";

export const NORM_VALIDATE_API = "norm-spec/validate/v1";
export const MAX_VALIDATION_FEEDBACK_BYTES = 8 * 1024;
export const MAX_VALIDATION_FEEDBACK_FINDINGS = 8;

type ValidationStatus = "ok" | "warning" | "error";

interface ValidationDiagnostic {
  code: string;
  message: string;
  field: string | null;
  suggestion: string | null;
}

interface ValidationResult {
  path: string;
  status: ValidationStatus;
  errors: ValidationDiagnostic[];
  warnings: ValidationDiagnostic[];
}

export interface ValidationSummary {
  files: number;
  errors: number;
  warnings: number;
}

export interface ValidationResponse {
  apiVersion: typeof NORM_VALIDATE_API;
  root: string;
  results: ValidationResult[];
  summary: ValidationSummary;
}

export interface ValidationFeedback {
  status: string;
  text: string | null;
}

export function shouldValidateAfterTool(
  toolName: string,
  isError: boolean,
): boolean {
  return !isError && (toolName === "write" || toolName === "edit");
}

export function parseValidationResponse(value: unknown): ValidationResponse {
  if (
    !isRecord(value) ||
    value.apiVersion !== NORM_VALIDATE_API ||
    typeof value.root !== "string" ||
    !Array.isArray(value.results) ||
    !isRecord(value.summary)
  ) {
    throw invalidValidationResponse();
  }

  const results = value.results.map(parseValidationResult);
  const summary = parseValidationSummary(value.summary);
  const countedErrors = results.reduce((count, result) => count + result.errors.length, 0);
  const countedWarnings = results.reduce((count, result) => count + result.warnings.length, 0);
  if (
    summary.files !== results.length ||
    summary.errors !== countedErrors ||
    summary.warnings !== countedWarnings
  ) {
    throw invalidValidationResponse();
  }

  return {
    apiVersion: NORM_VALIDATE_API,
    root: value.root,
    results,
    summary,
  };
}

export function presentValidation(response: ValidationResponse): ValidationFeedback {
  const { files, errors, warnings } = response.summary;
  if (errors === 0 && warnings === 0) {
    return { status: files === 0 ? "norm: empty" : `norm: valid (${files} files)`, text: null };
  }

  const summary = validationSummaryText(response.summary);
  const text = renderFindingFeedback(response);
  return {
    status: `norm: ${errors} errors, ${warnings} warnings`,
    text,
  };
}

export function presentValidationFailure(failure: BridgeClientError): ValidationFeedback {
  const detail = `${oneLine(failure.code, 160)}: ${oneLine(failure.message, 1024)}`;
  const text = boundFeedback(
    [
      "[dsh-norm-spec post-edit validation unavailable]",
      detail,
      "The write/edit already completed. Validation did not block or revert it.",
      "Run the bundled `norm validate --all --strict` command for an explicit retry.",
    ].join("\n"),
  );
  return {
    status: `norm: validation failed (${oneLine(failure.code, 160)})`,
    text,
  };
}

function parseValidationResult(value: unknown): ValidationResult {
  if (
    !isRecord(value) ||
    typeof value.path !== "string" ||
    !isValidationStatus(value.status) ||
    !Array.isArray(value.errors) ||
    !Array.isArray(value.warnings)
  ) {
    throw invalidValidationResponse();
  }
  const errors = value.errors.map(parseDiagnostic);
  const warnings = value.warnings.map(parseDiagnostic);
  const expectedStatus: ValidationStatus =
    errors.length > 0 ? "error" : warnings.length > 0 ? "warning" : "ok";
  if (value.status !== expectedStatus) throw invalidValidationResponse();
  return { path: value.path, status: value.status, errors, warnings };
}

function parseDiagnostic(value: unknown): ValidationDiagnostic {
  if (
    !isRecord(value) ||
    typeof value.code !== "string" ||
    typeof value.message !== "string" ||
    !isNullableString(value.field) ||
    !isNullableString(value.suggestion)
  ) {
    throw invalidValidationResponse();
  }
  return {
    code: value.code,
    message: value.message,
    field: value.field,
    suggestion: value.suggestion,
  };
}

function parseValidationSummary(value: Record<string, unknown>): ValidationSummary {
  if (
    !isNonNegativeInteger(value.files) ||
    !isNonNegativeInteger(value.errors) ||
    !isNonNegativeInteger(value.warnings)
  ) {
    throw invalidValidationResponse();
  }
  return { files: value.files, errors: value.errors, warnings: value.warnings };
}

function renderFindingFeedback(response: ValidationResponse): string {
  const lines = [
    "[dsh-norm-spec post-edit validation: soft feedback]",
    validationSummaryText(response.summary),
  ];
  let emitted = 0;
  const total = response.summary.errors + response.summary.warnings;
  for (const result of response.results) {
    for (const [severity, findings] of [
      ["ERROR", result.errors],
      ["WARNING", result.warnings],
    ] as const) {
      for (const finding of findings) {
        if (emitted >= MAX_VALIDATION_FEEDBACK_FINDINGS) break;
        lines.push(renderFinding(severity, result.path, finding));
        emitted += 1;
      }
    }
    if (emitted >= MAX_VALIDATION_FEEDBACK_FINDINGS) break;
  }
  if (emitted < total) lines.push(`... ${total - emitted} additional diagnostics omitted.`);
  lines.push(
    "The write/edit already completed. This feedback did not block or revert it.",
    "Run the bundled `norm validate --all --strict` command for complete details.",
  );
  return boundFeedback(lines.join("\n"));
}

function renderFinding(
  severity: "ERROR" | "WARNING",
  path: string,
  finding: ValidationDiagnostic,
): string {
  const field = finding.field === null ? "" : ` field=${oneLine(finding.field, 192)}`;
  const suggestion =
    finding.suggestion === null ? "" : ` Fix: ${oneLine(finding.suggestion, 512)}`;
  return `- ${severity} ${oneLine(path, 384)} [${oneLine(finding.code, 192)}]${field}: ${oneLine(finding.message, 768)}${suggestion}`;
}

function validationSummaryText(summary: ValidationSummary): string {
  return `${summary.errors} errors and ${summary.warnings} warnings across ${summary.files} .norm files.`;
}

function boundFeedback(value: string): string {
  if (Buffer.byteLength(value, "utf8") <= MAX_VALIDATION_FEEDBACK_BYTES) return value;
  const suffix =
    "\n... feedback truncated. Run the bundled `norm validate --all --strict` command for complete details.";
  const budget = MAX_VALIDATION_FEEDBACK_BYTES - Buffer.byteLength(suffix, "utf8");
  let prefix = "";
  let bytes = 0;
  for (const character of value) {
    const next = Buffer.byteLength(character, "utf8");
    if (bytes + next > budget) break;
    prefix += character;
    bytes += next;
  }
  return `${prefix.trimEnd()}${suffix}`;
}

/** SHA-1 digest over rendered convention content, for re-injection suppression. */
export function digestText(value: string): string {
  return createHash("sha1").update(value, "utf8").digest("hex");
}

function oneLine(value: string, maximumCharacters: number): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  const characters = Array.from(normalized);
  return characters.length <= maximumCharacters
    ? normalized
    : `${characters.slice(0, Math.max(0, maximumCharacters - 1)).join("")}…`;
}

function invalidValidationResponse(): BridgeClientError {
  return new BridgeClientError(
    "dsh-norm-spec/client/validation-invalid",
    "bridge validation result had an unexpected schema or inconsistent summary",
  );
}

function isValidationStatus(value: unknown): value is ValidationStatus {
  return value === "ok" || value === "warning" || value === "error";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
