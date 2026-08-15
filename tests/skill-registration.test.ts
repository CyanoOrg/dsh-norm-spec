import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  loadSkillRegistration,
  parseSkillDocument,
} from "../src/skill-registration.ts";

const packagedSkill = fileURLToPath(
  new URL("../skills/dsh-norm-spec/SKILL.md", import.meta.url),
);

test("packaged SKILL.md loads as a runtime registration", () => {
  const registration = loadSkillRegistration();
  assert.equal(registration.name, "dsh-norm-spec");
  assert.ok(registration.description.length > 0);
  assert.ok(registration.content.includes("# dsh-norm-spec"));
  assert.equal(registration.source, "runtime");
});

test("packaged SKILL.md round-trips through the parser unchanged", () => {
  const raw = readFileSync(packagedSkill, "utf8");
  const parsed = parseSkillDocument(raw);
  assert.equal(parsed.name, "dsh-norm-spec");
  // Re-serializing the registration must reproduce the exact package file:
  // frontmatter fields and body are stable, so drift between the parser's
  // view and the file on disk is impossible by construction.
  const serialized = [
    "---",
    `name: ${parsed.name}`,
    `description: ${parsed.description}`,
    "---",
    parsed.content,
  ].join("\n");
  assert.equal(serialized, raw);
});

test("frontmatter contract: name and description required", () => {
  assert.throws(
    () => parseSkillDocument("---\nname: dsh-norm-spec\n---\n# body\n"),
    /description.*required/,
  );
  assert.throws(
    () => parseSkillDocument("---\ndescription: x\n---\n# body\n"),
    /name.*kebab-case/,
  );
});

test("frontmatter contract: unsupported fields and malformed documents fail", () => {
  assert.throws(
    () => parseSkillDocument("---\nname: dsh-norm-spec\ndescription: x\nextra: y\n---\n# body\n"),
    /unknown frontmatter field/,
  );
  assert.throws(
    () => parseSkillDocument("# no frontmatter\n"),
    /frontmatter-missing/,
  );
  assert.throws(
    () => parseSkillDocument("---\nname: dsh-norm-spec\ndescription: x\n"),
    /frontmatter-unclosed/,
  );
  assert.throws(
    () => parseSkillDocument("---\nname: dsh-norm-spec\ndescription: x\n---\n   \n"),
    /body-missing/,
  );
});
