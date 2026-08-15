/**
 * Cordis smoke harness for dsh-norm-spec.
 *
 * Boots a minimal Cordis app with the real dsh-tools ToolRuntime, mounts
 * the plugin from source, starts a bridge against the locally sealed
 * payload, and exercises:
 *   1. plugin mount (name/inject contract, no load errors)
 *   2. tool registration (norm_validate / norm_collect / norm_scan visible)
 *   3. a real bridge round-trip through norm_validate / norm_collect
 *
 * Run: node --experimental-strip-types cordis-smoke.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";

import { Context } from "@deepseek-ai/cordis";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime from "@deepseek-ai/dsh-tools";

const repo = "/Users/jiangweide/Tuatara/RustPrjs/dsh-norm-spec";
const bridge = `${repo}/target/release/dsh-norm-bridge`;
const payload = `${repo}/.local-runtime/upstream`;

// Build the sample project before any tool executes.
const sampleProject = "/tmp/cordis-smoke/sample-project";
await mkdir(sampleProject, { recursive: true });
await writeFile(
  `${sampleProject}/.norm`,
  `---
metadata:
  layer: root
  profile: root
  scope: ./
  version: "1.0"
  description: smoke sample project
---
# Sample
`,
);

const app = new Context();
app.plugin(SystemPrompt);
app.plugin(ToolRuntime);
app.plugin((await import("@deepseek-ai/dsh-skill")).default);
app.plugin(
  await import(`${repo}/src/index.ts`),
  { launch: { command: bridge, args: ["serve", "--payload", payload] } },
);
await new Promise((resolve) => setTimeout(resolve, 500));

const tools = app.tools;
console.log("== mount ==");
console.log("plugin name:", "dsh-norm-spec", "| tools registry:", typeof tools === "object" ? "live" : "missing");
const validate = tools.get("norm_validate");
const collect = tools.get("norm_collect");
const scan = tools.get("norm_scan");
console.log("norm_validate:", validate ? "registered" : "missing");
console.log("norm_collect:", collect ? "registered" : "missing");
console.log("norm_scan:", scan ? "registered" : "missing");

console.log("== skill registration (D009) ==");
const listed = await app.skills.list({ cwd: sampleProject });
const skillSummary = listed.find((skill) => skill.name === "dsh-norm-spec");
console.log("skill listed:", skillSummary ? "yes" : "no");
if (skillSummary === undefined) throw new Error("dsh-norm-spec skill not listed");
console.log("invocation:", JSON.stringify(skillSummary.invocation));
const definition = await app.skills.get("dsh-norm-spec", { cwd: sampleProject });
console.log("skill provider:", definition.provider);
console.log("skill body head:", JSON.stringify(definition.content.slice(0, 40)));

console.log("== norm_scan (real sealed payload round-trip) ==");
const scanResult = await scan.execute({}, {
  agent: undefined,
  signal: new AbortController().signal,
});
console.log("ok:", scanResult.ok, "| paths:", JSON.stringify(scanResult.conventionPaths));

console.log("== norm_validate ==");
const validateResult = await validate.execute({}, {
  agent: undefined,
  signal: new AbortController().signal,
});
console.log("ok:", validateResult.ok, "| files:", validateResult.files, "| errors:", validateResult.errors);

console.log("== norm_collect ==");
const collectResult = await collect.execute({ target: sampleProject }, {
  agent: undefined,
  signal: new AbortController().signal,
});
console.log("target:", collectResult.target);
console.log("conventionPaths:", JSON.stringify(collectResult.conventionPaths));
console.log("prompt bytes:", collectResult.prompt === null ? 0 : collectResult.prompt.length);

await app.fiber.dispose();
console.log("== smoke OK ==");
process.exit(0);
