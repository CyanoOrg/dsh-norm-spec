import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { afterEach } from "node:test";

import {
  PACKAGE_RELEASE_API,
  PLATFORM_PACKAGES,
  PLATFORM_RUNTIME_API,
  platformKey,
  resolvePlatformRuntime,
} from "../src/runtime-resolver.ts";

const cleanup: string[] = [];
afterEach(async () => {
  while (cleanup.length > 0) {
    await rm(cleanup.pop()!, { recursive: true, force: true });
  }
});

const REAL_BRIDGE_ENV = process.env.DSH_NORM_BRIDGE;
const REAL_PAYLOAD_ENV = process.env.DSH_NORM_PAYLOAD;
afterEach(() => {
  if (REAL_BRIDGE_ENV === undefined) delete process.env.DSH_NORM_BRIDGE;
  else process.env.DSH_NORM_BRIDGE = REAL_BRIDGE_ENV;
  if (REAL_PAYLOAD_ENV === undefined) delete process.env.DSH_NORM_PAYLOAD;
  else process.env.DSH_NORM_PAYLOAD = REAL_PAYLOAD_ENV;
});

test("platformKey maps every supported host", () => {
  assert.equal(platformKey("darwin" as NodeJS.Platform, "arm64"), "darwin-arm64");
  assert.equal(platformKey("darwin" as NodeJS.Platform, "x64"), "darwin-x64");
  assert.equal(platformKey("linux" as NodeJS.Platform, "x64"), "linux-x64");
  assert.equal(platformKey("win32" as NodeJS.Platform, "x64"), "win32-x64");
});

test("platformKey rejects unsupported hosts visibly", () => {
  assert.throws(
    () => platformKey("linux" as NodeJS.Platform, "arm64"),
    /no runtime package for linux-arm64/,
  );
});

test("environment override still wins and validates its pair", async () => {
  process.env.DSH_NORM_BRIDGE = "/tmp/dev-bridge";
  delete process.env.DSH_NORM_PAYLOAD;
  await assert.rejects(resolvePlatformRuntime(), /DSH_NORM_PAYLOAD is missing/);

  process.env.DSH_NORM_PAYLOAD = "/tmp/dev-payload";
  const launch = await resolvePlatformRuntime();
  assert.deepEqual(launch, {
    command: "/tmp/dev-bridge",
    args: ["serve", "--payload", "/tmp/dev-payload"],
  });
});

/**
 * Build a fake installed-package tree around the resolver module: a root
 * release.json next to src/ and a platform package with runtime.json,
 * release.json, bridge, and payload entries.
 */
async function stageInstalledTree(
  version: string,
  platformVersion: string,
): Promise<{ root: string; native: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "dsh-resolver-"));
  cleanup.push(root);
  const src = path.join(root, "src");
  const native = path.join(root, "node_modules", "@cyanoorg", "dsh-norm-spec-darwin-arm64");
  await mkdir(src, { recursive: true });
  await mkdir(native, { recursive: true });

  // The resolver reads ../release.json relative to src/runtime-resolver.ts.
  // Copy the real modules there so import.meta.url lands inside the fake root.
  const testsDir = path.dirname(fileURLToPath(import.meta.url));
  const srcDir = path.join(testsDir, "..", "src");
  const { readFile } = await import("node:fs/promises");
  for (const module of ["runtime-resolver.ts", "bridge-client.ts"]) {
    await writeFile(
      path.join(src, module),
      await readFile(path.join(srcDir, module), "utf8"),
    );
  }

  await writeFile(
    path.join(root, "release.json"),
    JSON.stringify({ apiVersion: PACKAGE_RELEASE_API, version }),
  );
  await writeFile(
    path.join(native, "release.json"),
    JSON.stringify({ apiVersion: PACKAGE_RELEASE_API, version: platformVersion }),
  );
  await writeFile(
    path.join(native, "runtime.json"),
    JSON.stringify({
      apiVersion: PLATFORM_RUNTIME_API,
      bridge: "bin/dsh-norm-bridge",
      payload: "payload/",
    }),
  );
  await mkdir(path.join(native, "bin"), { recursive: true });
  await mkdir(path.join(native, "payload"), { recursive: true });
  await writeFile(path.join(native, "bin", "dsh-norm-bridge"), "");
  return { root, native };
}

test("packaged resolution walks manifests to the native runtime", async () => {
  delete process.env.DSH_NORM_BRIDGE;
  const tree = await stageInstalledTree("0.1.0-beta.1", "0.1.0-beta.1");

  // Resolve the staged module, not the repository one.
  const staged = await import(
    path.join(tree.root, "src", "runtime-resolver.ts").replace(/\.ts$/, ".ts")
  );
  const launch = await staged.resolvePlatformRuntime({
    platform: "darwin",
    arch: "arm64",
  } as never);
  assert.equal(
    await fs.realpath(launch.command as string),
    await fs.realpath(path.join(tree.native, "bin/dsh-norm-bridge")),
  );
  const payloadArg = (launch.args as string[]).find((a) => a.startsWith("/"));
  assert.ok(payloadArg, "payload arg resolves to an absolute path");
  assert.equal(
    await fs.realpath(payloadArg),
    await fs.realpath(path.join(tree.native, "payload")),
  );
});

test("version mismatch between root and platform packages fails loudly", async () => {
  delete process.env.DSH_NORM_BRIDGE;
  const tree = await stageInstalledTree("0.1.0-beta.1", "0.1.0-beta.2");
  const staged = await import(
    path.join(tree.root, "src", "runtime-resolver.ts").replace(/\.ts$/, ".ts")
  );
  await assert.rejects(
    staged.resolvePlatformRuntime({ platform: "darwin", arch: "arm64" } as never),
    /version .* does not match/,
  );
});
