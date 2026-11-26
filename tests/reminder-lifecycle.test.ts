import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import test from "node:test";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Context } from "@deepseek-ai/cordis";
import { agentEvents, type Agent } from "@deepseek-ai/dsh-agent";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import {
  SESSION_FORMAT_VERSION,
  Session,
  SessionId,
  type SessionHeader,
} from "@deepseek-ai/dsh-session";
import { BridgeClient } from "../src/bridge-client.ts";
import { hostSessionEvents, pluginReminderSource, replaceSurfaceOp } from "../src/host-compat.ts";
import * as plugin from "../src/index.ts";

const fixture = fileURLToPath(new URL("./fixtures/fake-bridge.mjs", import.meta.url));
const ruleMarker = "DSH_NORM_SPEC_CONTEXT_MULTI_V1";

async function mountedSession(mode: string) {
  const app = new Context();
  app.plugin((await import("@deepseek-ai/dsh-system-prompt")).default);
  app.plugin((await import("@deepseek-ai/dsh-tools")).default);
  app.plugin((await import("@deepseek-ai/dsh-skill")).default);
  app.plugin(plugin, {
    launch: { command: process.execPath, args: [fixture, mode] },
    bridgeIdleTtlMs: 0,
  });
  await setTimeout(300);
  const id = SessionId("reminder-" + mode);
  const header = {
    version: SESSION_FORMAT_VERSION, id, createdAt: Date.now(), cwd: tmpdir(), isSeeded: false,
  } as unknown as SessionHeader;
  const session = Session.create(id, [], header);
  const agent = { session } as unknown as Agent;
  const step = async (index: number, current = agent, signal = new AbortController().signal) => {
    const payload = {
      messages: [], turn: 1, step: index, signal,
      modelSelection: { provider: "stub", model: "stub" },
    };
    const decision = await agentEvents(app, current).waterfall(
      "agent/pre-step", payload, () => Promise.resolve({ kind: "enter" as const, messages: [] }),
    );
    assert.equal(decision.kind, "enter");
    for (const message of decision.messages) {
      session.append("user/message", message, { surfaceOp: "append" });
    }
  };
  const dispose = async () => {
    agentEvents(app, agent).emit("agent/disposed", {});
    await (app as { dispose?: () => Promise<unknown> }).dispose?.();
  };
  return { session, step, dispose };
}

function visibleMessages(session: Session) {
  const surface = new Set(session.surface.nodes);
  return hostSessionEvents(session).filter((event) =>
    event.type === "user/message" && surface.has(event.seq));
}

test("D022 preserves post-edit feedback, retires legacy duplicates and reinstates a shadowed slot", async () => {
  const { session, step, dispose } = await mountedSession("ready");
  try {
    await step(1);
    const initial = visibleMessages(session).find((event) => JSON.stringify(event.data).includes(ruleMarker));
    assert.ok(initial);
    session.append("user/message", createUserMessage({
      content: [{ type: "text", text: "A legacy instruction still on the surface." }],
      source: pluginReminderSource(plugin.name, "instructions"),
    }), { surfaceOp: "append" });
    const feedback = createUserMessage({
      content: [{ type: "text", text: "Post-edit feedback." }],
      source: pluginReminderSource(plugin.name, "notice", "Post-edit validation"),
    });
    session.append("user/message", feedback, { surfaceOp: "append" });
    await step(2);
    const visible = visibleMessages(session);
    assert.equal(visible.filter((event) => JSON.stringify(event.data).includes(ruleMarker)).length, 1);
    assert.ok(visible.some((event) => event.type === "user/message" && event.data.id === feedback.id));
    assert.ok(!JSON.stringify(visible).includes("A legacy instruction still on the surface."));

    const slot = visible.find((event) => JSON.stringify(event.data).includes(ruleMarker));
    assert.ok(slot);
    session.append("user/message", createUserMessage({
      content: [{ type: "text", text: "Compaction stand-in without rules." }],
      source: pluginReminderSource("fixture-compaction", "notice", "Compacted history"),
    }), {
      surfaceOp: replaceSurfaceOp(slot.seq),
      sourceEventSeqs: [slot.seq],
    });
    await step(3, { session } as unknown as Agent);
    const restored = visibleMessages(session).filter((event) => JSON.stringify(event.data).includes(ruleMarker));
    assert.equal(restored.length, 1);
    assert.notEqual(restored[0]?.seq, slot.seq);
  } finally {
    await dispose();
  }
});

test("D022 replaces a persisted instruction when the bridge cannot start", async () => {
  const { session, step, dispose } = await mountedSession("startup-failure");
  try {
    session.append("user/message", createUserMessage({
      content: [{ type: "text", text: ruleMarker }],
      source: pluginReminderSource(plugin.name, "instructions"),
    }), { surfaceOp: "append" });
    await step(1);
    const visible = JSON.stringify(visibleMessages(session));
    assert.ok(!visible.includes(ruleMarker));
    assert.match(visible, /\.norm conventions unavailable \[fake\/startup\]/);
  } finally {
    await dispose();
  }
});

test("D022 leaves the slot untouched when collection finishes after abort", async (t) => {
  const { session, step, dispose } = await mountedSession("ready");
  try {
    await step(1);
    const before = [...session.surface.nodes];
    const controller = new AbortController();
    const request = t.mock.method(BridgeClient.prototype, "request", async () => {
      controller.abort();
      return {
        apiVersion: "dsh-norm-spec/prompt-context-multi/v1",
        root: ".",
        scopes: [{ target: ".", conventionPaths: [], conventions: [] }],
        prompt: null,
      };
    });
    await step(2, undefined, controller.signal);
    assert.equal(request.mock.callCount(), 1);
    assert.deepEqual(session.surface.nodes, before);
  } finally {
    await dispose();
  }
});
