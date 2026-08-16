// Stage and npm-pack the root package (no Rust build needed; pure TS).
// Env: BUILD_OUTPUT (tarball destination, default dist/root).
// Prints the tarball path as JSON on the last stdout line.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("..", import.meta.url));
const outputDir = process.env.BUILD_OUTPUT ?? path.join(repo, "dist", "root");

const { stageRootPackage } = await import(new URL("./package-staging.ts", import.meta.url).href);
const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo }).toString().trim();
const repoPkg = JSON.parse(await readFile(path.join(repo, "package.json"), "utf8"));
const version = repoPkg.version;

const stageDir = path.join(repo, ".local-runtime", "stage", "root");
await rm(stageDir, { recursive: true, force: true });
await mkdir(path.dirname(stageDir), { recursive: true });
await stageRootPackage({ repoRoot: repo, packageRoot: stageDir, sourceRevision: revision });

const manifest = JSON.parse(await readFile(path.join(stageDir, "package.json"), "utf8"));
if (manifest.name !== "@cyanoorg/dsh-norm-spec") throw new Error(`staged manifest identity mismatch: ${manifest.name}`);
if (manifest.version !== version) throw new Error(`staged manifest version mismatch: ${manifest.version}`);

await mkdir(outputDir, { recursive: true });
const tarball = path.join(outputDir, `cyanoorg-dsh-norm-spec-${version}.tgz`);
await rm(tarball, { force: true });
await rm(`${tarball}.sha256`, { force: true });
execFileSync("npm", ["pack", "--ignore-scripts", `--pack-destination=${outputDir}`, stageDir], { stdio: "pipe", shell: process.platform === "win32" });
const bytes = await readFile(tarball);
const sha256 = createHash("sha256").update(bytes).digest("hex");
await writeFile(`${tarball}.sha256`, `${sha256}  ${path.basename(tarball)}\n`, "utf8");
console.log(JSON.stringify({ archive: tarball, sha256, version }));
