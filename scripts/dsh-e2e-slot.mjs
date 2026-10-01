/**
 * Single-slot replacement E2E (D008), step-level: one dsh session whose
 * model first calls the write tool (mutating .norm to REV-2 mid-turn),
 * then answers. Asserts the final model request carries exactly ONE
 * reminder and it contains the REV-2 text — the old reminder was
 * replaced on the surface, not appended beside.
 *
 * Run: node --experimental-strip-types dsh-e2e-slot.mjs
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";

const repo = "/Users/jiangweide/Tuatara/RustPrjs/dsh-norm-spec";
const home = "/tmp/dsh-e2e/dshhome";
const project = "/tmp/cordis-smoke/sample-project";
const normPath = `${project}/.norm`;

const REV1 = `---
metadata:
  layer: root
  profile: root
  scope: ./
  version: "1.0"
  description: REV-1 original convention
---
# Sample
`;
const REV2 = `---
metadata:
  layer: root
  profile: root
  scope: ./
  version: "1.0"
  description: REV-2-CHANGED convention
---
# Sample
`;

const chatRequests = [];
let phase = 0; // derived per-request from tool-result count; kept for logging

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
    // dsh 0.2.0 llm-deepseek posts to the Messages endpoint (/v1/messages),
    // not /chat/completions — route by request body, not URL.
    let nReminders = 0;
    let reminderHasRev2 = false;
    let reminderHasRev1 = false;
    let isTitleRequest = false;
    let toolResults = 0;
    try {
      const parsed = JSON.parse(body);
      const first = (parsed.messages ?? [])[0];
      isTitleRequest = first !== undefined && typeof first.content === "string"
        && first.content.startsWith("Create a concise title");
      // Content-driven routing: route on how many tool results the model has
      // already seen — immune to request interleaving and title-prompt drift.
      toolResults = (parsed.messages ?? []).filter(
        (m) => m.role === "tool" || (Array.isArray(m.content) && m.content.some((b) => b.type === "tool_result")),
      ).length;
      for (const message of parsed.messages ?? []) {
        const text = typeof message.content === "string"
          ? message.content
          : Array.isArray(message.content)
            ? message.content.map((b) => b.text ?? "").join("\n")
            : "";
        if (text.includes("DSH_NORM_SPEC_CONTEXT_V1")) {
          nReminders += 1;
          if (text.includes("REV-2-CHANGED")) reminderHasRev2 = true;
          if (text.includes("REV-1 original")) reminderHasRev1 = true;
        }
      }
    } catch { /* ignore */ }
    chatRequests.push({ nReminders, reminderHasRev2, reminderHasRev1 });
    console.log(`[stub] chat#${chatRequests.length}: reminders=${nReminders} reminderRev1=${reminderHasRev1} reminderRev2=${reminderHasRev2} toolResults=${toolResults}`);

    res.writeHead(200, { "content-type": "text/event-stream" });
    let frames;
    if (isTitleRequest) {
      frames = textTurn("session title");
    } else if (toolResults === 0) {
      // The fs-observation-policy requires read-before-overwrite: first a
      // read tool call, then (next round) the write.
      frames = toolCallTurn("reading first", "read", { file_path: normPath }, "call_1");
    } else if (toolResults === 1) {
      // Now the write is permitted (the file was observed).
      frames = toolCallTurn("", "write", { file_path: normPath, content: REV2 }, "call_2");
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

await writeFile(normPath, REV1);
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
  "update the project conventions as instructed, then confirm",
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
const last = chatRequests[chatRequests.length - 1];
const pass = last !== undefined && last.nReminders === 1
  && last.reminderHasRev2 && !last.reminderHasRev1;
console.log("[e2e] single-slot replace:", pass ? "PASS" : "FAIL",
  `(last request: reminders=${last?.nReminders} reminderRev1=${last?.reminderHasRev1} reminderRev2=${last?.reminderHasRev2})`);
process.exit(pass ? 0 : 1);
