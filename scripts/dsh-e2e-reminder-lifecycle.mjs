/**
 * Request-level regression for D022, using a real DSH CLI and a local
 * stub provider. Set DSH_NORM_BRIDGE and DSH_NORM_PAYLOAD to a verified
 * local runtime. DSH_BIN selects the host binary and defaults to dsh.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const bridge = process.env.DSH_NORM_BRIDGE;
const payload = process.env.DSH_NORM_PAYLOAD;
assert.ok(bridge && isAbsolute(bridge), "DSH_NORM_BRIDGE must be an absolute executable path");
assert.ok(payload && isAbsolute(payload), "DSH_NORM_PAYLOAD must be an absolute payload path");

const scratch = await mkdtemp(join(tmpdir(), "dsh-norm-lifecycle-"));
const home = join(scratch, "home");
const profile = join(home, "profiles", "headless");
const project = join(scratch, "project");
const norm = join(project, ".norm");
const rule = "REMINDER_BODY_D022";
const declaration = [
  "---", "metadata:", "  layer: root", "  scope: ./", '  version: "1.0"',
  "  description: Layout marker", "---", "", rule, "",
].join("\n");
const plugin = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const requests = [];

function modelReply(toolInput, index, openAi) {
  const tool = toolInput !== undefined;
  if (openAi) {
    const delta = tool ? { tool_calls: [{
      index: 0, id: "probe_" + index, type: "function",
      function: { name: "read", arguments: JSON.stringify(toolInput) },
    }] } : { content: "Done." };
    const chunk = { choices: [{
      index: 0, delta, finish_reason: tool ? "tool_calls" : "stop",
    }] };
    return "data: " + JSON.stringify(chunk) + "\n\ndata: [DONE]\n\n";
  }
  const block = tool
    ? { type: "tool_use", id: "probe_" + index, name: "read", input: {} }
    : { type: "text", text: "" };
  const delta = tool
    ? { type: "input_json_delta", partial_json: JSON.stringify(toolInput) }
    : { type: "text_delta", text: "Done." };
  const events = [
    { type: "message_start", message: { usage: { input_tokens: 1, output_tokens: 1 } } },
    { type: "content_block_start", index: 0, content_block: block },
    { type: "content_block_delta", index: 0, delta },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: tool ? "tool_use" : "end_turn" } },
    { type: "message_stop" },
  ];
  return events.map((event) => "data: " + JSON.stringify(event) + "\n\n").join("")
    + "data: [DONE]\n\n";
}

const server = createServer(async (request, response) => {
  try {
    let body = "";
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
    const openAi = request.url.endsWith("/chat/completions");
    const mainRequest = input.tools?.some((tool) => (tool.name ?? tool.function?.name) === "read");
    let toolInput;
    const index = requests.length;
    if (mainRequest) {
      const text = JSON.stringify(input.messages);
      requests.push({
        rules: (text.match(/REMINDER_BODY_D022/g) ?? []).length,
        unavailable: text.includes("conventions unavailable"),
      });
      if (index === 0) await rm(norm);
      if (index === 1 || index === 3) await writeFile(norm, declaration);
      if (index === 2) await writeFile(norm, "Invalid .norm input\n");
      if (index < 4) toolInput = { file_path: "step-" + index + ".md" };
    }
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(modelReply(toolInput, index, openAi));
  } catch (error) {
    response.writeHead(500);
    response.end(String(error));
  }
});

try {
  await mkdir(profile, { recursive: true });
  await mkdir(project);
  await writeFile(norm, declaration);
  await Promise.all(Array.from({ length: 4 }, (_, index) =>
    writeFile(join(project, "step-" + index + ".md"), "Fixture file.\n")));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const endpoint = "http://127.0.0.1:" + server.address().port + "/v1";
  await writeFile(join(profile, "cordis.patch.yml"), [
    "- insert:",
    "    - id: norm-lifecycle-probe",
    "      name: " + JSON.stringify(plugin),
    "      config:",
    "        launch: " + JSON.stringify({ command: bridge, args: ["serve", "--payload", payload] }),
    "- id: llm-deepseek",
    "  config:",
    "    baseUrl: " + endpoint,
    "    thinking: disabled",
    "    models:",
    "      - id: stub-model",
    "        contextWindow: 128000",
    "",
  ].join("\n"));
  await promisify(execFile)(process.env.DSH_BIN ?? "dsh", [
    "--profile", "headless", "Run the local convention lifecycle probe.",
  ], {
    cwd: project,
    timeout: 30_000,
    env: {
      PATH: process.env.PATH,
      HOME: home,
      DSH_HOME: home,
      DEEPSEEK_API_KEY: "local-stub",
      DEEPSEEK_BASE_URL: endpoint,
    },
  });
  assert.deepEqual(requests, [
    { rules: 1, unavailable: false },
    { rules: 0, unavailable: false },
    { rules: 1, unavailable: false },
    { rules: 0, unavailable: true },
    { rules: 1, unavailable: false },
  ]);
  console.log("D022 provider requests passed for rules, empty, recovery, failure, and recovery.");
} finally {
  server.close();
  await rm(scratch, { recursive: true, force: true });
}
