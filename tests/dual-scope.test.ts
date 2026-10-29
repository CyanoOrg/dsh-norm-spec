/**
 * Dual-scope layout-index isolation test (D018): ONE plugin instance, ONE
 * section provider, two sessions with different workspaces — the exact
 * granularity of the cross-session misbinding incident. The regression
 * (a plugin-level singleton) fails the per-scope assertions by
 * construction.
 *
 * @module dsh-norm-spec/tests/dual-scope
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Context } from "@deepseek-ai/cordis";
import { agentEvents, type Agent } from "@deepseek-ai/dsh-agent";
import {
  SESSION_FORMAT_VERSION,
  Session,
  SessionId,
  type SessionHeader,
} from "@deepseek-ai/dsh-session";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(repo, "tests/fixtures/fake-bridge.mjs");
const LAYOUT_SECTION = "dsh-norm-spec:layout-index";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function mountedApp(config: object = {}): Promise<Context> {
  const app = new Context();
  app.plugin((await import("@deepseek-ai/dsh-system-prompt")).default);
  app.plugin((await import("@deepseek-ai/dsh-tools")).default);
  app.plugin((await import("@deepseek-ai/dsh-skill")).default);
  app.plugin(await import(`${repo}/src/index.ts`), {
    launch: { command: process.execPath, args: [fixture] },
    ...config,
  });
  await sleep(300);
  return app;
}

function headerFor(id: string, cwd: string): SessionHeader {
  // Cast: 0.2.0's SessionHeader requires isSeeded while rc.6's rejects it
  // (excess-property check) — one structural literal cannot satisfy both
  // lines directly, so the cross-line shape goes through a cast.
  return {
    version: SESSION_FORMAT_VERSION,
    id: SessionId(id),
    createdAt: Date.now(),
    isSeeded: false,
    cwd,
  } as unknown as SessionHeader;
}

interface DrivenAgent {
  agent: Agent;
  dispose: () => void;
}

/** Drive one fake agent through the real plugin listeners (D018/D019). */
async function driveAgent(app: Context, id: string, cwd: string): Promise<DrivenAgent> {
  const session = Session.create(SessionId(id), [], headerFor(id, cwd));
  const agent = { session } as unknown as Agent;
  const events = agentEvents(app, agent);
  // Both creation events back to back: the host-compat seam subscribes to
  // agent/created on the 0.2.0 line and agent/session-start on rc.6 — this
  // makes the creation -> startBridge path real on both lines.
  events.emit("agent/created", { source: "startup" });
  // rc.6-line creation event: absent from the 0.2.0 event map, hence the
  // cast — same rationale as the host-compat seam subscription.
  events.emit("agent/session-start" as never, {} as never);
  await events.waterfall(
    "agent/pre-step",
    {
      messages: [],
      turn: 1,
      step: 1,
      signal: new AbortController().signal,
    },
    () => Promise.resolve({ kind: "enter" as const, messages: [] }),
  );
  return {
    agent,
    dispose: () => {
      events.emit("agent/disposed", {});
    },
  };
}

async function layoutSectionText(app: Context, scope?: object): Promise<string> {
  const assembly = scope === undefined
    ? await app.systemPrompt.assemble()
    : await app.systemPrompt.assemble({ scope: scope as never });
  const section = assembly.sections.find((s) => s.name === LAYOUT_SECTION);
  assert.ok(section !== undefined, "layout section present in assembly");
  return section.text;
}

test("D018: one plugin instance serves each session its own workspace map", async () => {
  const wsA = path.join(tmpdir(), "dual-ws-a");
  const wsB = path.join(tmpdir(), "dual-ws-b");
  const app = await mountedApp();
  try {
    const a = await driveAgent(app, "dual-a", wsA);
    const b = await driveAgent(app, "dual-b", wsB);

    const textA = await layoutSectionText(app, a.agent);
    assert.match(textA, /LAYOUT-A-ROOT/, "session A sees its own root");
    assert.doesNotMatch(textA, /LAYOUT-B-ROOT/, "session A does not see B's map");

    const textB = await layoutSectionText(app, b.agent);
    assert.match(textB, /LAYOUT-B-ROOT/, "session B sees its own root");
    assert.doesNotMatch(textB, /LAYOUT-A-ROOT/, "session B does not see A's map");

    // Agent-less assembly carries no map at all (empty contribution).
    const textNone = await layoutSectionText(app);
    assert.equal(textNone, "", "agent-less assembly carries no layout map");

    // Agent churn on a resident session: the fresh agent's scope resolves
    // the same session's map through the re-keyed index.
    const sessionA = (a.agent as unknown as { session: Session }).session;
    const agentA2 = { session: sessionA } as unknown as Agent;
    const events2 = agentEvents(app, agentA2);
    events2.emit("agent/created", { source: "resume" });
    events2.emit("agent/session-start" as never, {} as never);
    await events2.waterfall(
      "agent/pre-step",
      {
        messages: [],
        turn: 2,
        step: 1,
        signal: new AbortController().signal,
      },
      () => Promise.resolve({ kind: "enter" as const, messages: [] }),
    );
    const textA2 = await layoutSectionText(app, agentA2);
    assert.match(textA2, /LAYOUT-A-ROOT/, "re-keyed scope serves the same session map");

    a.dispose();
    b.dispose();
    events2.emit("agent/disposed", {});
  } finally {
    const maybe = (app as unknown as { dispose?: () => Promise<unknown> }).dispose;
    if (maybe !== undefined) await maybe.call(app);
  }
});

test("D018 ordering: a fresh agent's first assembly carries no map", async () => {
  const app = await mountedApp();
  try {
    const session = Session.create(
      SessionId("dual-c"),
      [],
      headerFor("dual-c", path.join(tmpdir(), "dual-ws-c")),
    );
    const agent = { session } as unknown as Agent;
    const events = agentEvents(app, agent);
    events.emit("agent/created", { source: "startup" });
    events.emit("agent/session-start" as never, {} as never);
    await sleep(150); // bridge starts; no pre-step yet
    const before = await layoutSectionText(app, agent);
    assert.equal(before, "", "assembly precedes the first pre-step refresh");
    events.emit("agent/disposed", {});
  } finally {
    const maybe = (app as unknown as { dispose?: () => Promise<unknown> }).dispose;
    if (maybe !== undefined) await maybe.call(app);
  }
});

// Keep the temp dir referenced so mkdtemp stays imported on all lines.
void mkdtemp;
