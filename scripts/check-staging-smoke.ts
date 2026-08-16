// Local staging smoke check (development only; not part of npm test).
// Stages the root and one native package, npm-packs both, installs them
// into an isolated consumer (with the pinned @deepseek-ai peers), and
// imports the staged lib as real ESM — the production-shaped path.
// Usage: node --experimental-strip-types scripts/check-staging-smoke.ts
import { mkdtemp, rm, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { stagePlatformPackage, stageRootPackage } from "./package-staging.ts";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo }).toString().trim();
const root = await mkdtemp(path.join(tmpdir(), "dsh-stage-"));
let failed = false;
try {
  const r = await stageRootPackage({ repoRoot: repo, packageRoot: path.join(root, "root"), sourceRevision: revision });
  console.log("root staged:", r.packageName, r.version);
  const p = await stagePlatformPackage({
    repoRoot: repo, packageRoot: path.join(root, "native"), sourceRevision: revision,
    target: "aarch64-apple-darwin",
    bridge: path.join(repo, "target/release/dsh-norm-bridge"),
    payload: path.join(repo, ".local-runtime/upstream"),
  });
  console.log("native staged:", p.packageName, p.version);

  const patch = await readFile(path.join(root, "root", "cordis.patch.yml"), "utf8");
  if (patch.includes("DSH_NORM_BRIDGE")) throw new Error("packaged patch still carries env launch");
  console.log("packaged patch (no env launch): ok");
  const bridgeStat = await stat(path.join(root, "native", "bin", "dsh-norm-bridge"));
  if ((bridgeStat.mode & 0o777) !== 0o755) throw new Error("bridge is not executable");
  console.log("bridge executable: ok");

  // npm pack both staged packages into tarballs.
  const tarballs = path.join(root, "tarballs");
  await (await import("node:fs/promises")).mkdir(tarballs);
  await execFileSync("npm", ["pack", "--ignore-scripts", "--json", `--pack-destination=${tarballs}`, path.join(root, "root")], { stdio: "pipe" });
  await execFileSync("npm", ["pack", "--ignore-scripts", "--json", `--pack-destination=${tarballs}`, path.join(root, "native")], { stdio: "pipe" });
  console.log("packed both packages");

  // Isolated consumer: install the two tarballs plus the pinned peers, then
  // import the staged lib exactly like an installed plugin would.
  const consumer = path.join(root, "consumer");
  await writeFile(path.join(consumer, "..", "consumer-init.json"), "{}");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(consumer);
  await writeFile(path.join(consumer, "package.json"), JSON.stringify({
    name: "dsh-norm-spec-staging-smoke", version: "0.0.0", private: true, type: "module",
  }, null, 2) + "\n");
  const rootTarball = path.join(tarballs, "cyanoorg-dsh-norm-spec-0.1.0-alpha.1.tgz");
  const nativeTarball = path.join(tarballs, "cyanoorg-dsh-norm-spec-darwin-arm64-0.1.0-alpha.1.tgz");
  const devDeps = JSON.parse(await readFile(path.join(repo, "package.json"), "utf8")).devDependencies;
  const peerArgs = Object.entries(devDeps)
    .filter(([name]) => name.startsWith("@deepseek-ai/"))
    .flatMap(([name, version]) => [`${name}@${version}`]);
  await execFileSync("npm", [
    "install", "--no-save", "--ignore-scripts", "--cache", path.join(root, "npm-cache"),
    rootTarball, nativeTarball, ...peerArgs,
  ], { cwd: consumer, stdio: "pipe" });
  console.log("installed root+native+peers into isolated consumer");

  // Import the installed lib: real ESM resolution through node_modules.
  const installed = path.join(consumer, "node_modules", "@cyanoorg", "dsh-norm-spec", "lib", "index.js");
  const mod = await import(installed);
  const need = ["name", "inject", "apply"];
  for (const k of need) if (!(k in mod)) throw new Error(`installed lib missing export: ${k}`);
  console.log("installed lib imports cleanly with", need.join(","));

  // The native package resolves from the installed tree — packaged resolution.
  // Clear any development env override so the packaged path is exercised.
  const hadBridge = process.env.DSH_NORM_BRIDGE;
  const hadPayload = process.env.DSH_NORM_PAYLOAD;
  delete process.env.DSH_NORM_BRIDGE;
  delete process.env.DSH_NORM_PAYLOAD;
  try {
    const resolver = await import(path.join(consumer, "node_modules", "@cyanoorg", "dsh-norm-spec", "lib", "runtime-resolver.js"));
    const launch = await resolver.resolvePlatformRuntime();
    const fs = await import("node:fs/promises");
    const bridgeReal = await fs.realpath(launch.command);
    const expectedReal = await fs.realpath(path.join(consumer, "node_modules", "@cyanoorg", "dsh-norm-spec-darwin-arm64"));
    if (!bridgeReal.startsWith(expectedReal)) throw new Error(`packaged resolution escaped the native package: ${bridgeReal}`);
    console.log("packaged resolver finds bridge inside native package: ok");
  } finally {
    if (hadBridge !== undefined) process.env.DSH_NORM_BRIDGE = hadBridge;
    if (hadPayload !== undefined) process.env.DSH_NORM_PAYLOAD = hadPayload;
  }
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  await rm(root, { recursive: true, force: true });
}
if (failed) process.exit(1);
console.log("staging smoke: PASS");
