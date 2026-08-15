/**
 * Load the packaged dsh-norm-spec Skill for runtime registration (D009).
 *
 * The package file `skills/dsh-norm-spec/SKILL.md` is the single source for
 * the Skill's frontmatter and body. This module performs a strict parse of
 * the owned document only; it is not a general frontmatter or YAML parser.
 * A missing or malformed Skill file is a packaging defect and fails visibly
 * at plugin load instead of silently skipping registration.
 *
 * @module dsh-norm-spec/skill-registration
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { SkillRegistration } from "@deepseek-ai/dsh-skill";

const SKILL_FILE = new URL("../skills/dsh-norm-spec/SKILL.md", import.meta.url);
const SKILL_NAME = "dsh-norm-spec";
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Read and parse the packaged Skill document into a runtime registration. */
export function loadSkillRegistration(): SkillRegistration {
  let raw: string;
  try {
    raw = readFileSync(fileURLToPath(SKILL_FILE), "utf8");
  } catch (error) {
    throw new Error(
      `dsh-norm-spec/skill/package-incomplete: packaged SKILL.md is missing or unreadable (${errorMessage(error)})`,
    );
  }
  const parsed = parseSkillDocument(raw);
  if (parsed.name !== SKILL_NAME) {
    throw new Error(
      `dsh-norm-spec/skill/name-mismatch: packaged Skill is "${parsed.name}", expected "${SKILL_NAME}"`,
    );
  }
  return parsed;
}

/**
 * Strictly parse one owned SKILL.md document: a leading frontmatter block
 * with single-line `name` and `description` fields, then a markdown body.
 * Exported for tests; production callers use {@link loadSkillRegistration}.
 */
export function parseSkillDocument(raw: string): SkillRegistration {
  if (!raw.startsWith("---\n")) {
    throw new Error("dsh-norm-spec/skill/frontmatter-missing: document must start with a frontmatter block");
  }
  const end = raw.indexOf("\n---\n", 4);
  if (end < 0) {
    throw new Error("dsh-norm-spec/skill/frontmatter-unclosed: no closing --- fence found");
  }
  const fields = new Map<string, string>();
  for (const line of raw.slice(4, end).split("\n")) {
    const match = /^([a-zA-Z][a-zA-Z0-9-]*): (.*)$/.exec(line);
    if (match === null) {
      throw new Error(
        `dsh-norm-spec/skill/frontmatter-invalid: unsupported frontmatter line ${JSON.stringify(line)}`,
      );
    }
    fields.set(match[1]!, match[2]!);
  }
  for (const key of fields.keys()) {
    if (key !== "name" && key !== "description" && key !== "whenToUse") {
      throw new Error(
        `dsh-norm-spec/skill/frontmatter-invalid: unknown frontmatter field "${key}" (supported: name, description, whenToUse)`,
      );
    }
  }
  const name = fields.get("name");
  const description = fields.get("description");
  if (name === undefined || !SKILL_NAME_PATTERN.test(name)) {
    throw new Error(
      `dsh-norm-spec/skill/frontmatter-invalid: "name" must be a kebab-case identifier`,
    );
  }
  if (description === undefined || description.length === 0) {
    throw new Error(
      `dsh-norm-spec/skill/frontmatter-invalid: "description" is required and must be non-empty`,
    );
  }
  const content = raw.slice(end + 5);
  if (content.trim().length === 0) {
    throw new Error("dsh-norm-spec/skill/body-missing: document has no markdown body");
  }
  const whenToUse = fields.get("whenToUse");
  return {
    name,
    description,
    ...(whenToUse !== undefined ? { whenToUse } : {}),
    source: "runtime",
    content,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
