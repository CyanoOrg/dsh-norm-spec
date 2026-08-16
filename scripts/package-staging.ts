import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, copyFile, cp, lstat, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { PACKAGE_RELEASE_API, PLATFORM_PACKAGES, type PlatformKey } from "../src/runtime-resolver.ts";

const execFileAsync = promisify(execFile);
const SOURCE_REVISION = /^[0-9a-f]{40}$/u;

export const PLATFORM_DEFINITIONS = {
  "darwin-arm64": { suffix: "darwin-arm64", target: "aarch64-apple-darwin", os: "darwin", cpu: "arm64" },
  "darwin-x64": { suffix: "darwin-x64", target: "x86_64-apple-darwin", os: "darwin", cpu: "x64" },
  "linux-x64": { suffix: "linux-x64", target: "x86_64-unknown-linux-gnu", os: "linux", cpu: "x64" },
  "win32-x64": { suffix: "win32-x64", target: "x86_64-pc-windows-msvc", os: "win32", cpu: "x64" },
} as const;

export interface PackageStageResult {
  packageName: string;
  version: string;
  packageRoot: string;
}

export interface RootPackageStageOptions {
  repoRoot: string;
  packageRoot: string;
  sourceRevision: string;
}

export interface PlatformPackageStageOptions extends RootPackageStageOptions {
  target: string;
  bridge: string;
  payload: string;
}

/**
 * Stage the root publish package: compiled lib/, skills, the bundle patch
 * (packaged mode — no env launch), the release manifest, and the publish
 * manifest. Deterministic given the exact source tree.
 */
export async function stageRootPackage(options: RootPackageStageOptions): Promise<PackageStageResult> {
  assert.match(options.sourceRevision, SOURCE_REVISION, "source revision must be a full commit sha");
  const repoRoot = options.repoRoot;
  const packageRoot = options.packageRoot;
  const manifest = await readPublishManifest(path.join(repoRoot, "packages", "root", "package.json"));

  await mkdir(packageRoot, { recursive: false });

  // Compile lib/ from src/. The staged copy lives under node_modules/ so it
  // stays git-invisible while inheriting the repo's package.json ("type":
  // "module") and node_modules type resolution for the @deepseek-ai peers.
  // Import specifiers are rewritten .ts -> .js for a clean emit-only compile.
  const stageSrc = path.join(repoRoot, ".staging-src");
  await rm(stageSrc, { recursive: true, force: true });
  await mkdir(stageSrc, { recursive: true });
  await cp(path.join(repoRoot, "src"), stageSrc, { recursive: true, force: true });
  for (const file of await readdir(stageSrc)) {
    if (!file.endsWith(".ts")) continue;
    const staged = path.join(stageSrc, file);
    let text = await readFile(staged, "utf8");
    text = text.replace(/\.ts"/g, '.js"').replace(/\.ts'/g, ".js'");
    await writeFile(staged, text, "utf8");
  }
  const libRoot = path.join(packageRoot, "lib");
  await mkdir(libRoot);
  await execFileAsync(path.join(repoRoot, "node_modules", ".bin", "tsc"), [
    "--outDir", libRoot,
    "--module", "nodenext",
    "--target", "es2023",
    "--moduleResolution", "nodenext",
    "--strict",
    "--skipLibCheck",
    "--verbatimModuleSyntax",
    "--lib", "es2023",
    path.join(stageSrc, "index.ts"),
  ]);
  await rm(stageSrc, { recursive: true, force: true });

  await cp(path.join(repoRoot, "skills"), path.join(packageRoot, "skills"), {
    recursive: true,
    force: false,
    errorOnExist: true,
  });

  // Packaged bundle patch: no launch config — the plugin resolves the native
  // runtime from the installed package tree (runtime-resolver).
  await writeFile(
    path.join(packageRoot, "cordis.patch.yml"),
    [
      "# dsh-norm-spec bundle patch (packaged distribution): mounts the",
      "# norm-spec convention adapter. The plugin resolves the bundled bridge",
      "# and sealed payload from the installed native package at runtime; no",
      "# environment variables are required.",
      "- insert:",
      "    - id: norm",
      "      name: 'dsh-norm-spec'",
      "",
    ].join("\n"),
    "utf8",
  );

  await copyFile(path.join(repoRoot, "LICENSE"), path.join(packageRoot, "LICENSE"));
  await writeJson(path.join(packageRoot, "release.json"), {
    apiVersion: PACKAGE_RELEASE_API,
    kind: "root",
    product: manifest.name,
    version: manifest.version,
    source: { revision: options.sourceRevision },
    packages: Object.values(PLATFORM_PACKAGES).map((definition) => ({
      name: `@cyanoorg/dsh-norm-spec-${definition.suffix}`,
      version: manifest.version,
      target: definition.target,
    })),
  });
  await copyFile(path.join(repoRoot, "packages", "root", "package.json"), path.join(packageRoot, "package.json"));
  return { packageName: manifest.name, version: manifest.version, packageRoot };
}

/**
 * Stage one native platform package: the bridge binary, the sealed upstream
 * payload, the runtime locator, and the release manifest.
 */
export async function stagePlatformPackage(options: PlatformPackageStageOptions): Promise<PackageStageResult> {
  assert.match(options.sourceRevision, SOURCE_REVISION, "source revision must be a full commit sha");
  const repoRoot = options.repoRoot;
  const definition = Object.values(PLATFORM_DEFINITIONS).find((candidate) => candidate.target === options.target);
  assert.ok(definition, `unsupported package target: ${options.target}`);
  const bridgeStat = await lstat(options.bridge);
  assert.ok(bridgeStat.isFile() && !bridgeStat.isSymbolicLink(), `bridge is not a regular file: ${options.bridge}`);
  const payloadStat = await lstat(options.payload);
  assert.ok(payloadStat.isDirectory() && !payloadStat.isSymbolicLink(), `payload is not a regular directory: ${options.payload}`);

  const packageName = `@cyanoorg/dsh-norm-spec-${definition.suffix}`;
  const manifest = await readPublishManifest(
    path.join(repoRoot, "packages", definition.suffix, "package.json"),
  );

  const executable = `dsh-norm-bridge${definition.os === "win32" ? ".exe" : ""}`;
  const binRoot = path.join(options.packageRoot, "bin");
  await mkdir(options.packageRoot, { recursive: false });
  await mkdir(binRoot);
  const installedBridge = path.join(binRoot, executable);
  await copyFile(options.bridge, installedBridge);
  if (definition.os !== "win32") await chmod(installedBridge, 0o755);
  await cp(options.payload, path.join(options.packageRoot, "upstream"), {
    recursive: true,
    force: false,
    errorOnExist: true,
  });
  await writeJson(path.join(options.packageRoot, "runtime.json"), {
    apiVersion: "dsh-norm-spec/platform-runtime/v1",
    bridge: `bin/${executable}`,
    payload: "upstream",
  });
  await writeJson(path.join(options.packageRoot, "release.json"), {
    apiVersion: PACKAGE_RELEASE_API,
    kind: "platform",
    product: "@cyanoorg/dsh-norm-spec",
    package: packageName,
    version: manifest.version,
    target: definition.target,
    source: { revision: options.sourceRevision },
  });
  await copyFile(
    path.join(repoRoot, "packages", definition.suffix, "package.json"),
    path.join(options.packageRoot, "package.json"),
  );
  await copyFile(path.join(repoRoot, "LICENSE"), path.join(options.packageRoot, "LICENSE"));
  return { packageName, version: manifest.version, packageRoot: options.packageRoot };
}

interface PublishManifest {
  name: string;
  version: string;
  optionalDependencies?: Record<string, string>;
}

async function readPublishManifest(file: string): Promise<PublishManifest> {
  const value = JSON.parse(await readFile(file, "utf8")) as unknown;
  assert.ok(typeof value === "object" && value !== null, `manifest is not an object: ${file}`);
  const manifest = value as Record<string, unknown>;
  assert.equal(typeof manifest.name, "string", `manifest name is missing: ${file}`);
  assert.equal(typeof manifest.version, "string", `manifest version is missing: ${file}`);
  return manifest as unknown as PublishManifest;
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export type { PlatformKey };
