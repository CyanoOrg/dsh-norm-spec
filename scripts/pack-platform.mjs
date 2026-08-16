// Stage and npm-pack one platform package (invoked by build-platform-candidate.sh).
// Env: BUILD_TARGET (rust triple), BUILD_OUTPUT (tarball destination).
// Prints the tarball path as JSON on the last stdout line.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const target = process.env.BUILD_TARGET;
const outputDir = process.env.BUILD_OUTPUT;
if (!target || !outputDir) throw new Error("BUILD_TARGET and BUILD_OUTPUT are required");

const { stagePlatformPackage } = await import(new URL("./package-staging.ts", import.meta.url).href);
const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo }).toString().trim();
const repoPkg = JSON.parse(await readFile(path.join(repo, "package.json"), "utf8"));
const version = repoPkg.version;

const suffix = { "aarch64-apple-darwin": "darwin-arm64", "x86_64-apple-darwin": "darwin-x64", "x86_64-unknown-linux-gnu": "linux-x64", "x86_64-pc-windows-msvc": "win32-x64" }[target];
if (!suffix) throw new Error(`unsupported target: ${target}`);

const stageDir = path.join(repo, ".local-runtime", "stage", suffix);
await rm(stageDir, { recursive: true, force: true });
await mkdir(path.dirname(stageDir), { recursive: true });
const bridge = path.join(repo, "target", "release", process.platform === "win32" ? "dsh-norm-bridge.exe" : "dsh-norm-bridge");
const payload = path.join(repo, ".local-runtime", "upstream");
await stagePlatformPackage({ repoRoot: repo, packageRoot: stageDir, sourceRevision: revision, target, bridge, payload });

const manifest = JSON.parse(await readFile(path.join(stageDir, "package.json"), "utf8"));
if (manifest.name !== `@cyanoorg/dsh-norm-spec-${suffix}`) throw new Error(`staged manifest identity mismatch: ${manifest.name}`);
if (manifest.version !== version) throw new Error(`staged manifest version mismatch: ${manifest.version}`);

const tarball = path.join(outputDir, `cyanoorg-dsh-norm-spec-${suffix}-${version}.tgz`);
execFileSync("npm", ["pack", "--ignore-scripts", `--pack-destination=${outputDir}`, stageDir], { stdio: "pipe" });
const bytes = await readFile(tarball);
const sha256 = createHash("sha256").update(bytes).digest("hex");
await writeFile(`${tarball}.sha256`, `${sha256}  ${path.basename(tarball)}\n`, "utf8");
console.log(JSON.stringify({ archive: tarball, sha256, suffix, version }));
