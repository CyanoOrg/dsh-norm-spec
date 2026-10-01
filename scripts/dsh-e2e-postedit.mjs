/**
 * Post-edit validation E2E: one dsh session whose model calls read then
 * write; the tools/post-execute validator re-derives the active rules and
 * appends soft feedback to the write tool result when conventions report
 * findings. Asserts the NEXT model request (or the write tool result in
 * the session log) carries the dsh-norm-spec post-edit feedback text.
 *
 * Run: node --experimental-strip-types dsh-e2e-postedit.mjs
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";

const repo = "/Users/jiangweide/Tuatara/RustPrjs/dsh-norm-spec";
const home = "/tmp/dsh-e2e/dshhome";
const project = "/tmp/cordis-smoke/sample-project";
const normPath = `${project}/.norm`;
const targetPath = `${project}/notes.md`;

const NORM = `---
metadata:
  layer: root
  profile: root
  scope: ./
  version: "1.0"
  description: post-edit scenario convention
---
# Sample
`;

let chatRequests = 0;
let phase = 0;

// dsh 0.2.0 llm-deepseek speaks the DeepSeek/Anthropic Messages SSE protocol:
// every data frame is a typed event (message_start → content_block_* →
// message_delta → message_stop), not OpenAI chat.completion.chunk.
function sseFrame(obj) {
  return `data: ${JSON.stringify(obj)}\n\n`;
}
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
    let sawFeedback = false;
    let isTitleRequest = false;
    try {
      const parsed = JSON.parse(body);
      const first = (parsed.messages ?? [])[0];
      isTitleRequest = first !== undefined && typeof first.content === "string"
        && first.content.startsWith("Create a concise title");
      // Content-driven routing (dsh 0.2.0): the title prompt shape changed and
      // message ordering interleaves with main-turn requests. Route on how many
      // tool results the model has already seen — 0 → read, 1 → write, else done.
      const toolResults = (parsed.messages ?? []).filter(
        (m) => m.role === "tool" || (Array.isArray(m.content) && m.content.some((b) => b.type === "tool_result")),
      ).length;
      if (!isTitleRequest) {
        phase = toolResults;
        for (const message of parsed.messages ?? []) {
          const text = typeof message.content === "string"
            ? message.content
            : Array.isArray(message.content)
              ? message.content.map((b) => b.text ?? "").join("\n")
              : "";
          if (text.includes("dsh-norm-spec post-edit")) sawFeedback = true;
        }
      }
    } catch { /* ignore */ }
    if (!isTitleRequest) {
      chatRequests += 1;
      console.log(`[stub] chat#${chatRequests}: sawFeedback=${sawFeedback} phase=${phase}`);
    }

    res.writeHead(200, { "content-type": "text/event-stream" });
    let frames;
    if (isTitleRequest) {
      frames = textTurn("title");
    } else if (phase === 0) {
      frames = toolCallTurn("reading", "read", { file_path: targetPath }, "c1");
      phase = 1;
    } else if (phase === 1) {
      frames = toolCallTurn("writing", "write", { file_path: targetPath, content: "# Notes\nhello\n" }, "c2");
      phase = 2;
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

await writeFile(normPath, NORM);
const patch = `- id: llm-deepseek
  config:
    baseUrl: http://127.0.0.1:${port}/v1
    thinking: disabled
    models:
      - id: stub-model
        contextWindow: 128000
`;
await writeFile(`${home}/profiles/headless/cordis.patch.yml`, patch);

const child = spawn("node", [
  "/tmp/dsh-e2e/node_modules/@deepseek-ai/dsh/lib/bin.js",
  "--profile", "headless",
  "create the notes file",
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
if (stderr.trim() !== "") console.log("[e2e] stderr tail:", stderr.slice(-300).replace(/\n/g, "\\n"));

// Second signal: the session log's write tool result should carry the
// post-edit feedback text appended by tools/post-execute.
let logHasFeedback = false;
try {
  const { execSync } = await import("node:child_process");
  const sessRoot = `${home}/sessions/--private-tmp-cordis-smoke-sample-project--`;
  const { readdirSync, statSync } = await import("node:fs");
  const latest = readdirSync(sessRoot)
    .map((name) => ({ name, mtime: statSync(`${sessRoot}/${name}`).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0]?.name;
  // Session format generations live side by side: session.jsonl.zstd (v0),
  // session.vN.jsonl.zstd (v>=1, e.g. v4 under dsh 0.2.0). Read the newest
  // generation file present; prefer the highest version number, fall back
  // to the legacy name.
  const sessDir = `${sessRoot}/${latest}`;
  const files = readdirSync(sessDir)
    .filter((f) => /^session(\.v\d+)?\.jsonl\.zstd$/.test(f));
  const genOf = (f) => Number(/\.v(\d+)\./.exec(f)?.[1] ?? 0);
  const pick = files.sort((a, b) => genOf(b) - genOf(a))[0];
  const zstd = execSync(`zstd -dc ${sessDir}/${pick}`, { maxBuffer: 64 << 20 }).toString();
  logHasFeedback = zstd.includes("dsh-norm-spec post-edit validation");
  console.log(`[e2e] session log (${pick}) has post-edit feedback:`, logHasFeedback);
} catch (error) {
  console.log("[e2e] session log check failed:", String(error).slice(0, 120));
}

const pass = logHasFeedback;
console.log("[e2e] post-edit feedback:", pass ? "PASS" : "FAIL");
process.exit(pass ? 0 : 1);
