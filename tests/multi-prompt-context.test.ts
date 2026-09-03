import assert from "node:assert/strict";
import test from "node:test";

import { pushTarget } from "../src/target-tracking.ts";
import {
  PROMPT_CONTEXT_MULTI_API,
  multiContextDigest,
  parseMultiPromptContext,
  renderMultiSystemReminder,
} from "../src/multi-prompt-context.ts";

test("pushTarget keeps a bounded recency set, deduplicated, most recent first", () => {
  assert.deepEqual(pushTarget(["."], "docs"), ["docs", "."]);
  assert.deepEqual(pushTarget(["docs", "crates", "."], "docs"), ["docs", "crates", "."]);
  assert.deepEqual(pushTarget(["a", "b", "c", "d"], "e"), ["e", "a", "b", "c"]);
  assert.deepEqual(pushTarget(["a", "b", "c", "d"], "b"), ["b", "a", "c", "d"]);
});

test("multi context parses a valid payload", () => {
  const context = parseMultiPromptContext({
    apiVersion: PROMPT_CONTEXT_MULTI_API,
    root: ".",
    scopes: [
      {
        target: "docs",
        conventionPaths: ["docs/.norm", ".norm"],
        conventions: [
          { path: "docs/.norm", frontmatter: { metadata: {} }, body: "# docs" },
          { path: ".norm", shared: true },
        ],
      },
      { target: ".", conventionPaths: [".norm"], conventions: [{ path: ".norm", shared: true }] },
    ],
    prompt: "DSH_NORM_SPEC_CONTEXT_MULTI_V1\nEND_DSH_NORM_SPEC_CONTEXT_MULTI_V1",
  });
  assert.equal(context.scopes.length, 2);
  assert.equal(multiContextDigest(context).length, 40);
  const reminder = renderMultiSystemReminder(context);
  assert.match(reminder, /scoped directories enumerated below, most recent first/);
  assert.match(reminder, /Conventions from: docs\/\.norm, \.norm/);
  // Exactly one closing tag: the wrapper's own. Engine content containing
  // `</system-reminder>` would be escaped, never break out of the wrapper.
  assert.equal(reminder.match(/<\/system-reminder>/g)?.length, 1);
});

test("multi context parses the all-empty typed state", () => {
  const context = parseMultiPromptContext({
    apiVersion: PROMPT_CONTEXT_MULTI_API,
    root: ".",
    scopes: [{ target: "docs", conventionPaths: [], conventions: [] }],
    prompt: null,
  });
  assert.equal(context.prompt, null);
});

test("multi context rejects schema drift and empty-state violations", () => {
  const valid = {
    apiVersion: PROMPT_CONTEXT_MULTI_API,
    root: ".",
    scopes: [{ target: "docs", conventionPaths: ["docs/.norm"], conventions: [{ path: "docs/.norm" }] }],
    prompt: "x",
  };
  assert.throws(() => parseMultiPromptContext({ ...valid, apiVersion: "dsh-norm-spec/prompt-context/v1" }));
  assert.throws(() => parseMultiPromptContext({ ...valid, scopes: "nope" }));
  assert.throws(() => parseMultiPromptContext({ ...valid, prompt: null }));
  assert.throws(() =>
    parseMultiPromptContext({
      ...valid,
      scopes: [{ target: "docs", conventionPaths: [], conventions: [] }],
      prompt: "not-empty",
    }),
  );
});
