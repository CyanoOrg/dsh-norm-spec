import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { type BridgeLaunch, BridgeClientError } from "./bridge-client.ts";

/**
 * Packaged runtime resolution (D011).
 *
 * The default launch resolves the native runtime package installed next to
 * this package: root `release.json` (identity) → platform package
 * `runtime.json` (locator) → bridge binary and sealed payload paths. The
 * `DSH_NORM_BRIDGE`/`DSH_NORM_PAYLOAD` environment override stays available
 * for local development and takes precedence.
 *
 * There is no `PATH` fallback: a missing or mismatched runtime is a visible
 * boot failure, never a silent empty ruleset.
 */

export const PACKAGE_RELEASE_API = "dsh-norm-spec/package-release/v1";
export const PLATFORM_RUNTIME_API = "dsh-norm-spec/platform-runtime/v1";

const MAX_MANIFEST_BYTES = 64 * 1024;

/** Native package suffix per platform key; names are `@cyanoorg/dsh-norm-spec-<key>`. */
export const PLATFORM_PACKAGES = {
  "darwin-arm64": { suffix: "darwin-arm64", target: "aarch64-apple-darwin" },
  "darwin-x64": { suffix: "darwin-x64", target: "x86_64-apple-darwin" },
  "linux-x64": { suffix: "linux-x64", target: "x86_64-unknown-linux-gnu" },
  "win32-x64": { suffix: "win32-x64", target: "x86_64-pc-windows-msvc" },
} as const;

export type PlatformKey = keyof typeof PLATFORM_PACKAGES;

export function platformKey(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): PlatformKey {
  const key = `${platform}-${arch}`;
  if (!(key in PLATFORM_PACKAGES)) {
    throw new BridgeClientError(
      "dsh-norm-spec/runtime/unsupported-platform",
      `dsh-norm-spec has no runtime package for ${key}`,
    );
  }
  return key as PlatformKey;
}

export interface ResolvePlatformRuntimeOptions {
  /** Override the host platform; defaults to `process.platform`. */
  platform?: NodeJS.Platform;
  /** Override the host arch; defaults to `process.arch`. */
  arch?: string;
  /** Override the root release.json path; defaults to this package's. */
  rootReleasePath?: string;
  /** Override module resolution; defaults to this module's require.resolve. */
  resolvePackagePath?: (id: string) => string;
}

export async function resolvePlatformRuntime(
  options: ResolvePlatformRuntimeOptions = {},
): Promise<BridgeLaunch> {
  const envBridge = process.env.DSH_NORM_BRIDGE;
  const envPayload = process.env.DSH_NORM_PAYLOAD;
  if (envBridge !== undefined && envBridge.length > 0) {
    if (envPayload === undefined || envPayload.length === 0) {
      throw new BridgeClientError(
        "dsh-norm-spec/runtime/locator-invalid",
        "DSH_NORM_BRIDGE is set but DSH_NORM_PAYLOAD is missing",
      );
    }
    return { command: envBridge, args: ["serve", "--payload", envPayload] };
  }

  const key = platformKey(options.platform, options.arch);
  const suffix = PLATFORM_PACKAGES[key].suffix;
  const rootRelease = await readJson(
    options.rootReleasePath ?? fileURLToPath(new URL("../release.json", import.meta.url)),
  );
  requireApi(rootRelease, PACKAGE_RELEASE_API, "root release manifest");
  const rootVersion = requireVersion(rootRelease, "root release manifest");

  const resolvePackagePath = options.resolvePackagePath ?? createRequire(import.meta.url).resolve;
  let locatorPath: string;
  try {
    locatorPath = resolvePackagePath(`@cyanoorg/dsh-norm-spec-${suffix}/runtime.json`);
  } catch {
    throw new BridgeClientError(
      "dsh-norm-spec/runtime/package-unavailable",
      `required platform runtime package is unavailable: @cyanoorg/dsh-norm-spec-${suffix}`,
    );
  }

  const packageRoot = path.dirname(locatorPath);
  const platformRelease = await readJson(path.join(packageRoot, "release.json"));
  requireApi(platformRelease, PACKAGE_RELEASE_API, "platform release manifest");
  const platformVersion = requireVersion(platformRelease, "platform release manifest");
  if (platformVersion !== rootVersion) {
    throw new BridgeClientError(
      "dsh-norm-spec/runtime/version-mismatch",
      `platform package version ${platformVersion} does not match root ${rootVersion}`,
    );
  }

  const locator = await readJson(locatorPath);
  requireApi(locator, PLATFORM_RUNTIME_API, "runtime locator");
  const bridgeRel = requireRelativePath(locator, "bridge", locatorPath);
  const payloadRel = requireRelativePath(locator, "payload", locatorPath);
  return {
    command: path.resolve(packageRoot, bridgeRel),
    args: ["serve", "--payload", path.resolve(packageRoot, payloadRel)],
  };
}

interface JsonRecord {
  readonly [key: string]: unknown;
}

async function readJson(file: string): Promise<JsonRecord> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (cause) {
    throw new BridgeClientError(
      "dsh-norm-spec/runtime/manifest-unreadable",
      `cannot read ${path.basename(file)}: ${file}`,
      cause instanceof Error ? cause.message : undefined,
    );
  }
  if (raw.length > MAX_MANIFEST_BYTES) {
    throw new BridgeClientError(
      "dsh-norm-spec/runtime/manifest-invalid",
      `${path.basename(file)} exceeds ${MAX_MANIFEST_BYTES} bytes`,
    );
  }
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return value as JsonRecord;
    }
  } catch {
    // fall through to the shared invalid-manifest error
  }
  throw new BridgeClientError(
    "dsh-norm-spec/runtime/manifest-invalid",
    `${path.basename(file)} is not a JSON object: ${file}`,
  );
}

function requireApi(
  value: JsonRecord,
  api: string,
  what: string,
): void {
  if (value.apiVersion !== api) {
    throw new BridgeClientError(
      "dsh-norm-spec/runtime/manifest-invalid",
      `${what} apiVersion is ${String(value.apiVersion)}, expected ${api}`,
    );
  }
}

function requireVersion(value: JsonRecord, what: string): string {
  const version = value.version;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new BridgeClientError(
      "dsh-norm-spec/runtime/manifest-invalid",
      `${what} version is not exact SemVer: ${String(version)}`,
    );
  }
  return version;
}

function requireRelativePath(
  value: JsonRecord,
  field: "bridge" | "payload",
  locatorPath: string,
): string {
  const rel = value[field];
  if (
    typeof rel !== "string" ||
    rel.length === 0 ||
    path.isAbsolute(rel) ||
    rel.split("/").includes("..")
  ) {
    throw new BridgeClientError(
      "dsh-norm-spec/runtime/locator-invalid",
      `runtime locator ${field} is not a safe relative path (${String(rel)}): ${locatorPath}`,
    );
  }
  return rel;
}
