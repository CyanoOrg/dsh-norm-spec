/**
 * P4 registry verification (RELEASE-SOP step 10).
 *
 * Installs @cyanoorg/dsh-norm-spec@<version> from the npm registry into
 * a fresh DSH_HOME (manual profile assembly: "dsh plugin add" requires
 * live LLM credentials and fails in credential-less environments), runs
 * headless dsh against a stub SSE LLM with ZERO bridge/payload env
 * overrides, and asserts the convention injection reaches the
 * model-visible request.
 *
 * The layout section is legitimately absent from a single-turn request
 * (D015 first-assembly timing; the multi-turn path is covered by the
 * rescope suite). --layout-probe instead drives the installed packaged
 * bridge's layoutIndex method (payload: the upstream dir inside the
 * same package) and asserts the DSH_NORM_LAYOUT_INDEX_V1 marker (D015;
 * scoped per session by D018) plus the sample root's own description.
 *
 * Usage: node --experimental-strip-types scripts/dsh-e2e-p4.mjs <version>
 *        [--layout-probe] [--home <dir>]
 */
import { createServer } from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const version = args.find((a) => !a.startsWith("--"));
if (!version) {
  console.error("usage: dsh-e2e-p4.mjs <version> [--layout-probe] [--home <dir>]");
  process.exit(2);
}
const layoutProbe = args.includes("--layout-probe");
const homeIdx = args.indexOf("--home");
const home = homeIdx >= 0 ? args[homeIdx + 1] : "/tmp/dsh-p4-" + version;
const host = process.env.DSH_E2E_HOST ?? "/tmp/dsh-e2e/node_modules";
const dshBin = host + "/@deepseek-ai/dsh/lib/bin.js";
const sample = "/tmp/cordis-smoke/sample-project";
if (!existsSync(dshBin)) throw new Error("E2E host install missing at " + host);
if (!existsSync(sample)) throw new Error("sample project missing at " + sample);

const profile = home + "/profiles/headless";
await mkdir(profile, { recursive: true });
await writeFile(path.join(profile, "package.json"), JSON.stringify({
  name: "dsh-profile-headless",
  private: true,
  dependencies: {
    "@deepseek-ai/dsh-base": "file:" + host + "/@deepseek-ai/dsh-base",
    "@deepseek-ai/dsh-headless": "file:" + host + "/@deepseek-ai/dsh-headless",
    "@cyanoorg/dsh-norm-spec": version,
  },
  dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-headless", "@cyanoorg/dsh-norm-spec"] } },
}, null, 2) + "\n");
// pnpm >=11.21 auto-appends minimumReleaseAgeExclude entries when installing
// fresh publishes — expected (RELEASE-SOP known quirk); appends are kept.
copyFileSync(host.replace("/node_modules", "") + "/dshhome/profiles/headless/pnpm-workspace.yaml", path.join(profile, "pnpm-workspace.yaml"));
await writeFile(path.join(profile, "cordis.yml"), "[]\n");

console.log("[p4] installing @cyanoorg/dsh-norm-spec@" + version + " into " + home);
// Up to three attempts at 0/2/4 min: fresh-publish tarball blobs can lag
// the packument on CDN edges for ~5 minutes (RELEASE-SOP known quirk).
let installed = false;
for (let attempt = 1; attempt <= 3 && !installed; attempt++) {
  try {
    execFileSync("pnpm", ["install"], { cwd: profile, stdio: "pipe" });
    installed = true;
  } catch {
    if (attempt === 3) {
      console.error("[p4] pnpm install failed after 3 attempts — on ERR_PNPM_FETCH_404 see RELEASE-SOP Known npm quirks (tarball CDN lag; probe the URL and wait)");
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 2 * 60_000));
  }
}

function sseFrame(obj) { return "data: " + JSON.stringify(obj) + "\n\n"; }
function textTurn(text) {
  return [
    { type: "message_start", message: { usage: { input_tokens: 1, output_tokens: 1 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" } },
    { type: "message_stop" },
  ];
}

let sawReminder = null;
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    try {
      const parsed = JSON.parse(body);
      for (const message of parsed.messages ?? []) {
        const text = typeof message.content === "string" ? message.content
          : Array.isArray(message.content) ? message.content.map((b) => b.text ?? "").join("\n") : "";
        if (/DSH_NORM_SPEC_CONTEXT(_MULTI)?_V1/.test(text) && sawReminder === null) sawReminder = text.slice(0, 120);
      }
    } catch { /* non-JSON */ }
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(textTurn("stub ack").map(sseFrame).join(""));
    res.write("data: [DONE]\n\n");
    res.end();
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const stubPort = server.address().port;
console.log("[p4] stub SSE LLM on 127.0.0.1:" + stubPort);

await writeFile(path.join(profile, "cordis.patch.yml"),
  "- id: llm-deepseek\n  config:\n    baseUrl: http://127.0.0.1:" + stubPort + "/v1\n    thinking: disabled\n    models:\n      - id: stub-model\n        contextWindow: 128000\n");

const child = spawn("node", [dshBin, "--profile", "headless", "acknowledge the project conventions"], {
  cwd: sample,
  env: {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    DSH_HOME: home,
    DEEPSEEK_API_KEY: "stub-key",
    DEEPSEEK_BASE_URL: "http://127.0.0.1:" + stubPort + "/v1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let stderr = "";
child.stderr.on("data", (d) => { stderr += d; });
const timeout = setTimeout(() => child.kill("SIGKILL"), 90_000);
await new Promise((r) => child.on("exit", r));
clearTimeout(timeout);
server.close();
if (stderr.trim() !== "") console.log("[p4] stderr tail:", stderr.slice(-160).replace(/\n/g, "|"));
console.log("[p4] reminder injection:", sawReminder !== null ? "PASS" : "FAIL");

let probeOk = true;
if (layoutProbe) {
  const storeDir = path.join(profile, "node_modules", ".pnpm");
  const found = (await import("node:fs")).readdirSync(storeDir).filter((d) => d.startsWith("@cyanoorg+dsh-norm-spec-darwin-arm64@"));
  const pkgDir = path.join(storeDir, found[0], "node_modules", "@cyanoorg", "dsh-norm-spec-darwin-arm64");
  const bridgeBin = path.join(pkgDir, "bin", "dsh-norm-bridge");
  const bchild = spawn(bridgeBin, ["serve", "--payload", path.join(pkgDir, "upstream")], { cwd: sample, stdio: ["pipe", "pipe", "pipe"] });
  let bout = "";
  bchild.stdout.on("data", (d) => { bout += d; });
  bchild.stderr.on("data", () => {});
  const frame = (obj) => JSON.stringify(obj) + "\n";
  bchild.stdin.write(frame({ apiVersion: "dsh-norm-spec/bridge/v1", type: "request", id: "p4", method: "layoutIndex", params: { root: "." } }));
  await new Promise((r) => setTimeout(r, 4000));
  bchild.kill("SIGKILL");
  let prompt = "";
  for (const line of bout.trim().split("\n")) {
    try {
      const o = JSON.parse(line);
      if (o.type === "response" && o.id === "p4") prompt = o.result?.prompt ?? "";
    } catch { /* events */ }
  }
  const marker = prompt.includes("DSH_NORM_LAYOUT_INDEX_V1");
  const ownRoot = prompt.includes("ROOT-ONLY-MARKER");
  console.log("[p4] layout marker (D015):", marker ? "PASS" : "FAIL", "| own root description:", ownRoot ? "PASS" : "FAIL");
  probeOk = marker && ownRoot;
}

const pass = sawReminder !== null && probeOk;
console.log("[p4] P4 " + version + ":", pass ? "PASS" : "FAIL");
process.exit(pass ? 0 : 1);
