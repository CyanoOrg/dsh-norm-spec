import assert from "node:assert/strict";
import test from "node:test";

import type { BridgeClient } from "../src/bridge-client.ts";
import { normScanTool, type ClientResolver } from "../src/native-tools.ts";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";

function stubClient(response: unknown): BridgeClient {
  return {
    getStatus: () => ({ state: "ready" }),
    request: async () => response,
  } as unknown as BridgeClient;
}

function resolverFor(client: BridgeClient): ClientResolver {
  return async () => client;
}

const exec = { agent: undefined, signal: new AbortController().signal } as unknown as ToolRunContext;

const COVERAGE = {
  apiVersion: "norm-spec/scan/v1",
  root: ".",
  directory_count: 3,
  directories: [
    { path: ".", depth: 0, file_count: 4, has_norm: true },
    { path: "crates", depth: 1, file_count: 0, has_norm: false },
    { path: "crates/engine", depth: 2, file_count: 2, has_norm: true },
  ],
  symlinks: [],
  naming: { directories: {}, files: {} },
  recurring_filenames: [],
  norm_coverage: { total_dirs: 3, dirs_with_norm: 2, ratio: 0.667 },
};

test("norm_scan reports declaring directories and convention file paths", async () => {
  const tool = normScanTool(resolverFor(stubClient(COVERAGE)));
  const value = (await tool.execute({}, exec)) as {
    ok: boolean;
    report: string;
    conventionPaths: string[];
  };
  assert.equal(value.ok, true);
  assert.deepEqual(value.conventionPaths, [".norm", "crates/engine/.norm"]);
  assert.match(value.report, /2 directories declare \.norm conventions/);
  assert.match(value.report, /- crates\/engine/);
  assert.match(value.report, /Coverage: 2 of 3 directories\./);
});

test("norm_scan reports an empty project without conventions", async () => {
  const empty = {
    ...COVERAGE,
    directory_count: 1,
    directories: [{ path: ".", depth: 0, file_count: 0, has_norm: false }],
    norm_coverage: { total_dirs: 1, dirs_with_norm: 0, ratio: 0 },
  };
  const tool = normScanTool(resolverFor(stubClient(empty)));
  const value = (await tool.execute({}, exec)) as { ok: boolean; report: string; conventionPaths: string[] };
  assert.equal(value.ok, true);
  assert.deepEqual(value.conventionPaths, []);
  assert.match(value.report, /No \.norm conventions found\./);
});

test("norm_scan fails visibly on a schema-invalid bridge response", async () => {
  const tool = normScanTool(
    resolverFor(stubClient({ apiVersion: "norm-spec/collect/v1", directories: "nope" })),
  );
  const value = (await tool.execute({}, exec)) as { ok: boolean; error: string | null };
  assert.equal(value.ok, false);
  assert.match(value.error ?? "", /unexpected schema/);
});
