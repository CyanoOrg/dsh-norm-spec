/**
 * Target re-scoping E2E (D013), step-level: one dsh session whose model
 * reads a file under a subdirectory that declares its own `.norm`. Asserts
 * the reminder starts scoped to the root chain only, then — after the read
 * — is re-scoped in place to the subdirectory chain (exactly one reminder,
 * containing the subdirectory marker and the `docs/.norm` chain).
 *
 * Prerequisites: /tmp/dsh-e2e/node_modules has @deepseek-ai/dsh@0.2.0-rc.2,
 * the plugin is linked into the headless profile, and the local runtime is
 * built (.local-runtime/stage/darwin-arm64/bin/dsh-norm-bridge
 * + .local-runtime/upstream).
 *
 * Run: node scripts/dsh-e2e-rescope.mjs
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

const repo = "/Users/jiangweide/Tuatara/RustPrjs/dsh-norm-spec";
const home = "/tmp/dsh-e2e/dshhome";
const project = "/tmp/cordis-smoke/sample-project";

const ROOT_NORM = `---
metadata:
  layer: root
  profile: root
  scope: ./
  version: "1.0"
  description: ROOT-ONLY-MARKER
---
# Sample
`;
const DOCS_NORM = `---
metadata:
  layer: docs
  profile: docs
  scope: ./
  version: "1.0"
  description: DOCS-SCOPE-MARKER
---
# Docs conventions
`;

const chatRequests = [];
let phase = 0; // 0: read under docs/ -> 1: final answer

function sseFrame(obj) {
  return `data: ${JSON.stringify(obj)}\n\n`;
}
// dsh 0.2.0 llm-deepseek speaks the DeepSeek/Anthropic Messages SSE protocol:
// typed events (message_start -> content_block_* -> message_stop), not
// OpenAI chat.completion.chunk frames.
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
function toolCallTurn(text, name, args, id) {
  return [
    { type: "message_start", message: { usage: { input_tokens: 1, output_tokens: 1 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 0 },
    { type: "content_block_start", index: 1, content_block: { type: "tool_use", id, name, input: {} } },
    { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: JSON.stringify(args) } },
    { type: "content_block_stop", index: 1 },
    { type: "message_delta", delta: { stop_reason: "tool_use" } },
    { type: "message_stop" },
  ];
}

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    // dsh 0.2.0 posts to /v1/messages; route by body shape (a messages
    // array), not by URL substring.
    let isChat = false;
    try { isChat = Array.isArray(JSON.parse(body).messages); } catch { /* not chat */ }
    if (!isChat) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
      return;
    }
    let nReminders = 0;
    let hasDocsScope = false;
    let hasRootScope = false;
    let hasLayoutIndex = false;
    try {
      const parsed = JSON.parse(body);
      for (const message of parsed.messages ?? []) {
        const text = typeof message.content === "string"
          ? message.content
          : Array.isArray(message.content)
            ? message.content.map((b) => b.text ?? "").join("\n")
            : "";
        if (text.includes("DSH_NORM_SPEC_CONTEXT")) {
          nReminders += 1;
          if (text.includes("DOCS-SCOPE-MARKER")) hasDocsScope = true;
          if (text.includes("ROOT-ONLY-MARKER")) hasRootScope = true;
        }
      }
    } catch { /* ignore */ }
    hasLayoutIndex = body.includes("DSH_NORM_LAYOUT_INDEX_V1");
    chatRequests.push({ nReminders, hasDocsScope, hasRootScope, hasLayoutIndex });
    console.log(`[stub] chat#${chatRequests.length}: reminders=${nReminders} root=${hasRootScope} docs=${hasDocsScope} index=${hasLayoutIndex} phase=${phase}`);

    let isTitleRequest = false;
    try {
      const parsed = JSON.parse(body);
      const first = (parsed.messages ?? [])[0];
      isTitleRequest = first !== undefined && typeof first.content === "string"
        && first.content.startsWith("Create a concise title");
    } catch { /* ignore */ }

    res.writeHead(200, { "content-type": "text/event-stream" });
    let frames;
    if (isTitleRequest) {
      frames = textTurn("session title");
    } else if (phase === 0) {
      frames = toolCallTurn("reading the docs", "read", { file_path: `${project}/docs/guide.md` }, "call_1");
      phase = 1;
    } else {
      frames = textTurn("done");
    }
    res.write(frames.map(sseFrame).join(""));
    res.write("data: [DONE]\n\n");
    res.end();
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

await mkdir(`${project}/docs`, { recursive: true });
await writeFile(`${project}/.norm`, ROOT_NORM);
await writeFile(`${project}/docs/.norm`, DOCS_NORM);
await writeFile(`${project}/docs/guide.md`, "# Guide\nRead me.\n");
const patch = [
  "# E2E profile patch: norm adapter mount + stub llm provider override.",
  "- insert:",
  "    - id: norm",
  "      name: 'dsh-norm-spec'",
  "      config:",
  "        launch:",
  "          command: !!js process.env.DSH_NORM_BRIDGE",
  "          args: !!js \"[\\\"serve\\\", \\\"--payload\\\", process.env.DSH_NORM_PAYLOAD ?? \\\"\\\"]\"",
  "- id: llm-deepseek",
  `  config:`,
  `    baseUrl: http://127.0.0.1:${port}/v1`,
  `    thinking: disabled`,
  `    models:`,
  `      - id: stub-model`,
  `        contextWindow: 128000`,
  "",
].join("\n");
await writeFile(`${home}/profiles/headless/cordis.patch.yml`, patch);

const child = spawn("node", [
  "/tmp/dsh-e2e/node_modules/@deepseek-ai/dsh/lib/bin.js",
  "--profile", "headless",
  "read the project guide, then confirm",
], {
  cwd: project,
  env: { ...process.env, DSH_HOME: home,
    DSH_NORM_BRIDGE: `${repo}/.local-runtime/stage/darwin-arm64/bin/dsh-norm-bridge`,
    DSH_NORM_PAYLOAD: `${repo}/.local-runtime/upstream`,
    DEEPSEEK_API_KEY: "stub-key",
    DEEPSEEK_BASE_URL: `http://127.0.0.1:${port}/v1` },
  stdio: ["ignore", "pipe", "pipe"],
});
let stdout = "";
let stderr = "";
child.stdout.on("data", (d) => { stdout += d; });
child.stderr.on("data", (d) => { stderr += d; });

const timeout = setTimeout(() => child.kill("SIGKILL"), 90_000);
const exitCode = await new Promise((resolve) => child.on("exit", resolve));
clearTimeout(timeout);
server.close();

console.log("[e2e] dsh exit:", exitCode);
console.log("[e2e] stdout tail:", stdout.slice(-200).replace(/\n/g, "\\n"));
if (stderr.trim() !== "") console.log("[e2e] stderr tail:", stderr.slice(-400).replace(/\n/g, "\\n"));
const first = chatRequests[0];
const last = chatRequests[chatRequests.length - 1];
const pass = first !== undefined && last !== undefined
  && first.nReminders === 1 && first.hasRootScope && !first.hasDocsScope
  && last.nReminders === 1 && last.hasDocsScope && last.hasRootScope
  && last.hasLayoutIndex;
console.log("[e2e] target re-scoping:", pass ? "PASS" : "FAIL",
  `(first: reminders=${first?.nReminders} root=${first?.hasRootScope} docs=${first?.hasDocsScope};`
  + ` last: reminders=${last?.nReminders} root=${last?.hasRootScope} docs=${last?.hasDocsScope} index=${last?.hasLayoutIndex})`);
process.exit(pass ? 0 : 1);
