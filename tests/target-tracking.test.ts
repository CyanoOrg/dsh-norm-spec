import assert from "node:assert/strict";
import test from "node:test";

import { projectConventionTarget } from "../src/target-tracking.ts";

test("read/edit/write project to the parent directory of file_path", () => {
  assert.equal(
    projectConventionTarget("read", { file_path: "/repo/docs/guide.md" }),
    "/repo/docs",
  );
  assert.equal(
    projectConventionTarget("edit", { file_path: "/repo/crates/app/src/main.rs" }),
    "/repo/crates/app/src",
  );
  assert.equal(
    projectConventionTarget("write", { file_path: "/repo/docs/.norm", content: "x" }),
    "/repo/docs",
  );
});

test("read/edit normalize to directories like write (D013)", () => {
  // The pre-D013 behavior returned the file path for read/edit; the target
  // string is embedded in the prompt projection, so file granularity churned
  // the digest for identical conventions within one directory.
  assert.equal(projectConventionTarget("read", { file_path: "README.md" }), ".");
  assert.equal(projectConventionTarget("read", { path: "docs/x.md" }), "docs");
});

test("bare relative filenames project to the session root", () => {
  assert.equal(projectConventionTarget("read", { file_path: "main.ts" }), ".");
});

test("legacy path field is accepted as a harmless alias", () => {
  assert.equal(projectConventionTarget("read", { path: "/repo/src" }), "/repo");
});

test("non-string, empty, and missing paths are ignored", () => {
  assert.equal(projectConventionTarget("read", { file_path: "" }), undefined);
  assert.equal(projectConventionTarget("read", { file_path: 7 }), undefined);
  assert.equal(projectConventionTarget("read", {}), undefined);
  assert.equal(projectConventionTarget("read", undefined), undefined);
  assert.equal(projectConventionTarget("read", null), undefined);
  assert.equal(projectConventionTarget("read", "main.ts"), undefined);
});

test("untracked tools never project a target, even with path-like fields", () => {
  assert.equal(
    projectConventionTarget("bash", { path: "/repo", command: "ls" }),
    undefined,
  );
  assert.equal(
    projectConventionTarget("glob", { pattern: "**/*.ts", path: "/repo" }),
    undefined,
  );
  assert.equal(projectConventionTarget("custom_tool", { file_path: "/repo/x" }), undefined);
});
