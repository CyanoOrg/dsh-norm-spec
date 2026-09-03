import assert from "node:assert/strict";
import test from "node:test";

import {
  LAYOUT_INDEX_API,
  parseLayoutIndex,
} from "../src/layout-index.ts";

const VALID = {
  apiVersion: LAYOUT_INDEX_API,
  root: ".",
  entries: [
    { path: ".", description: "root governance" },
    { path: "crates/engine", description: null },
  ],
  prompt: "DSH_NORM_LAYOUT_INDEX_V1\nmap\nEND_DSH_NORM_LAYOUT_INDEX_V1",
};

test("layout index parses a valid payload", () => {
  const index = parseLayoutIndex(VALID);
  assert.equal(index.apiVersion, LAYOUT_INDEX_API);
  assert.equal(index.entries[0].description, "root governance");
  assert.equal(index.entries[1].description, null);
  assert.match(index.prompt ?? "", /DSH_NORM_LAYOUT_INDEX_V1/);
});

test("layout index parses the empty typed map", () => {
  const index = parseLayoutIndex({ ...VALID, entries: [], prompt: null });
  assert.deepEqual(index.entries, []);
  assert.equal(index.prompt, null);
});

test("layout index rejects schema drift", () => {
  assert.throws(() => parseLayoutIndex({ ...VALID, apiVersion: "norm-spec/scan/v1" }));
  assert.throws(() => parseLayoutIndex({ ...VALID, entries: [{ path: 7, description: null }] }));
  assert.throws(() => parseLayoutIndex({ ...VALID, prompt: 42 }));
  assert.throws(() => parseLayoutIndex(null));
});
