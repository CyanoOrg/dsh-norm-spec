/**
 * Keyless E2E: real dsh --profile headless + dsh-norm-spec + stub SSE LLM.
 * Asserts the .norm convention <system-reminder> reaches the model request.
 *
 * Run: node --experimental-strip-types dsh-e2e-stub.mjs
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";

const repo = "/Users/jiangweide/Tuatara/RustPrjs/dsh-norm-spec";
const bridge = `${repo}/target/release/dsh-norm-bridge`;
const payload = `${repo}/.local-runtime/upstream`;

let sawInjection = null;
let allMessagesDump = [];
let requestCount = 0;

function sseFrame(obj) {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

const server = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    requestCount += 1;
    try {
      const parsed = JSON.parse(body);
      const messages = parsed.messages ?? [];
      allMessagesDump.push({ req: requestCount, roles: messages.map((m) => m.role) });
      for (const message of messages) {
        const text = typeof message.content === "string"
          ? message.content
          : Array.isArray(message.content)
            ? message.content.map((b) => b.text ?? "").join("\n")
            : "";
        if (text.includes("<system-reminder>") && sawInjection === null) {
          sawInjection = text;
        }
      }
      console.log(`[stub] #${requestCount}: ${messages.length} messages, stream=${parsed.stream === true}`);
    } catch { /* non-JSON */ }

    res.writeHead(200, { "content-type": "text/event-stream" });
    const frames = [
      { id: `stub-${requestCount}`, object: "chat.completion.chunk", created: 1, model: "stub-model",
        choices: [{ index: 0, delta: { role: "assistant", content: "stub ack" }, finish_reason: null }] },
      { id: `stub-${requestCount}`, object: "chat.completion.chunk", created: 1, model: "stub-model",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ];
    res.write(frames.map(sseFrame).join(""));
    res.write("data: [DONE]\n\n");
    res.end();
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const stubPort = server.address().port;
console.log("[e2e] stub SSE LLM on 127.0.0.1:" + stubPort);

const home = "/tmp/dsh-e2e/dshhome";
const patch = `- id: llm-deepseek
  config:
    baseUrl: http://127.0.0.1:${stubPort}/v1
    thinking: disabled
    models:
      - id: stub-model
        contextWindow: 128000
`;
await import("node:fs/promises").then((fs) =>
  fs.writeFile(`${home}/profiles/headless/cordis.patch.yml`, patch),
);

const child = spawn("node", [
  "/tmp/dsh-e2e/node_modules/@deepseek-ai/dsh/lib/bin.js",
  "--profile", "headless",
  "acknowledge the project conventions",
], {
  cwd: "/tmp/cordis-smoke/sample-project",
  env: {
    ...process.env,
    DSH_HOME: home,
    DSH_NORM_BRIDGE: bridge,
    DSH_NORM_PAYLOAD: payload,
    DEEPSEEK_API_KEY: "stub-key",
    DEEPSEEK_BASE_URL: `http://127.0.0.1:${stubPort}/v1`,
  },
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
console.log("[e2e] stdout tail:", stdout.slice(-300).replace(/\n/g, "\\n"));
if (stderr.trim() !== "") console.log("[e2e] stderr tail:", stderr.slice(-300).replace(/\n/g, "\\n"));
console.log("[e2e] requests:", JSON.stringify(allMessagesDump));
console.log("[e2e] saw <system-reminder> injection:", sawInjection !== null);
if (sawInjection !== null) {
  console.log("[e2e] injection excerpt:", JSON.stringify(sawInjection.slice(0, 400)));
}
process.exit(sawInjection !== null ? 0 : 1);
