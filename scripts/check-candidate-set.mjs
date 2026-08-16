// Verify the complete five-package candidate set downloaded into dist/downloaded:
// exactly five tarballs + five checksum sidecars, names matching the release
// identity, checksums binding each archive, and a source-bound inventory.
// Usage: node --experimental-strip-types scripts/check-candidate-set.mjs [dir]
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const repo = new URL("..", import.meta.url).pathname;
const dir = process.argv[2] ?? path.join(repo, "dist", "downloaded");
const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo }).toString().trim();
const version = JSON.parse(await readFile(path.join(repo, "package.json"), "utf8")).version;

const suffixes = ["darwin-arm64", "darwin-x64", "linux-x64", "win32-x64"];
const expected = [
  `cyanoorg-dsh-norm-spec-${version}`,
  ...suffixes.map((s) => `cyanoorg-dsh-norm-spec-${s}-${version}`),
].sort();
const files = (await readdir(dir)).sort();
const tarballs = files.filter((f) => f.endsWith(".tgz"));
const sidecars = files.filter((f) => f.endsWith(".tgz.sha256"));

if (tarballs.length !== 5 || sidecars.length !== 5) {
  throw new Error(`expected five tarballs and five checksums, found ${tarballs.length}/${sidecars.length}: ${files.join(", ")}`);
}
const actualBases = tarballs.map((f) => f.replace(/\.tgz$/, "")).sort();
for (let i = 0; i < expected.length; i++) {
  if (actualBases[i] !== expected[i]) throw new Error(`candidate set mismatch: expected ${expected[i]}, found ${actualBases[i]}`);
}

for (const tarball of tarballs) {
  const bytes = await readFile(path.join(dir, tarball));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const sidecar = await readFile(path.join(dir, `${tarball}.sha256`), "utf8");
  const declared = sidecar.split(/\s+/)[0];
  if (declared !== sha256) throw new Error(`checksum mismatch for ${tarball}: ${declared} != ${sha256}`);
  if (bytes.length <= 0) throw new Error(`empty archive: ${tarball}`);
}

const inventory = {
  apiVersion: "dsh-norm-spec/package-candidate-set/v1",
  version,
  sourceRevision: revision,
  packages: [],
};
for (const f of tarballs) {
  const bytes = await readFile(path.join(dir, f));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  inventory.packages.push({ archive: f, sha256, bytes: bytes.length });
}
await writeFile(path.join(dir, "inventory.json"), JSON.stringify(inventory, null, 2) + "\n", "utf8");
console.log(`candidate set verified: 5 packages @ ${version}, revision ${revision.slice(0, 7)}`);
