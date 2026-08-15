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
let phase = 0; // 0: first answer -> tool call; 1: final answer

function sseFrame(obj) {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    if (!req.url.includes("chat")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
      return;
    }
    let nReminders = 0;
    let reminderHasRev2 = false;
    let reminderHasRev1 = false;
    try {
      const parsed = JSON.parse(body);
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
    console.log(`[stub] chat#${chatRequests.length}: reminders=${nReminders} reminderRev1=${reminderHasRev1} reminderRev2=${reminderHasRev2} phase=${phase}`);

    // Title-generation requests must not consume a phase: detect them by
    // their dedicated system prompt.
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
      frames = [
        { id: "s", object: "chat.completion.chunk", created: 1, model: "m",
          choices: [{ index: 0, delta: { role: "assistant", content: "session title" }, finish_reason: null }] },
        { id: "s", object: "chat.completion.chunk", created: 1, model: "m",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      ];
    } else if (phase === 0) {
      // The fs-observation-policy requires read-before-overwrite: first a
      // read tool call, then (next round) the write.
      frames = [
        { id: "s", object: "chat.completion.chunk", created: 1, model: "m",
          choices: [{ index: 0, delta: { role: "assistant", content: "reading first" }, finish_reason: null }] },
        { id: "s", object: "chat.completion.chunk", created: 1, model: "m",
          choices: [{ index: 0, delta: { tool_calls: [{
            index: 0, id: "call_1", type: "function",
            function: { name: "read", arguments: JSON.stringify({ file_path: normPath }) },
          }] }, finish_reason: null }] },
        { id: "s", object: "chat.completion.chunk", created: 1, model: "m",
          choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
      ];
      phase = 1;
    } else if (phase === 1) {
      // Now the write is permitted (the file was observed).
      frames = [
        { id: "s", object: "chat.completion.chunk", created: 1, model: "m",
          choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] },
        { id: "s", object: "chat.completion.chunk", created: 1, model: "m",
          choices: [{ index: 0, delta: { tool_calls: [{
            index: 0, id: "call_2", type: "function",
            function: { name: "write", arguments: JSON.stringify({ file_path: normPath, content: REV2 }) },
          }] }, finish_reason: null }] },
        { id: "s", object: "chat.completion.chunk", created: 1, model: "m",
          choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
      ];
      phase = 2;
    } else {
      frames = [
        { id: "s", object: "chat.completion.chunk", created: 1, model: "m",
          choices: [{ index: 0, delta: { role: "assistant", content: "done" }, finish_reason: null }] },
        { id: "s", object: "chat.completion.chunk", created: 1, model: "m",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      ];
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
    DSH_NORM_BRIDGE: `${repo}/target/release/dsh-norm-bridge`,
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
