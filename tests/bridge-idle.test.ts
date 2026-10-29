/**
 * Bridge idle-recycling test (D019): reap after the TTL, lazy restart on
 * next use, immediate shutdown on disposal, and lease protection while a
 * plugin-issued request is in flight.
 *
 * @module dsh-norm-spec/tests/bridge-idle
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Context } from "@deepseek-ai/cordis";
import { agentEvents, type Agent } from "@deepseek-ai/dsh-agent";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
import {
  SESSION_FORMAT_VERSION,
  Session,
  SessionId,
  type SessionHeader,
} from "@deepseek-ai/dsh-session";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(repo, "tests/fixtures/fake-bridge.mjs");

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function mountedIdleApp(mode: string, pidFile: string): Promise<Context> {
  process.env.FAKE_BRIDGE_PID_FILE = pidFile;
  const app = new Context();
  app.plugin((await import("@deepseek-ai/dsh-system-prompt")).default);
  app.plugin((await import("@deepseek-ai/dsh-tools")).default);
  app.plugin((await import("@deepseek-ai/dsh-skill")).default);
  app.plugin(await import(`${repo}/src/index.ts`), {
    launch: { command: process.execPath, args: [fixture, mode] },
    bridgeIdleTtlMs: 150,
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

async function pidsOf(pidFile: string): Promise<number[]> {
  const text = await readFile(pidFile, "utf8");
  return text.trim().split("\n").filter((line) => line !== "").map(Number);
}

test("D019: idle reap, lazy restart, and disposal shutdown", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "norm-idle-"));
  const pidFile = path.join(dir, "pids.log");
  const app = await mountedIdleApp("ready", pidFile);
  try {
    const session = Session.create(SessionId("idle-a"), [], headerFor("idle-a", dir));
    const agent = { session } as unknown as Agent;
    const events = agentEvents(app, agent);
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

    const started = await pidsOf(pidFile);
    assert.ok(started.length >= 1, "fixture started");
    const first = started[0]!;

    // (i) after the TTL the bridge reaps itself.
    await sleep(450);
    assert.equal(alive(first), false, "idle bridge reaped after TTL");

    // (ii)+(iii) a native tool call lazily restarts a NEW bridge and works.
    const tool = app.tools.get("norm_validate");
    assert.ok(tool !== undefined, "norm_validate registered");
    const exec = {
      agent,
      signal: new AbortController().signal,
    } as unknown as ToolRunContext;
    const result = (await tool.execute({}, exec)) as { ok: boolean };
    assert.equal(result.ok, true, "tool succeeds after reap");
    const restarted = await pidsOf(pidFile);
    assert.ok(restarted.length > started.length, "a new fixture process appeared");
    const current = restarted[restarted.length - 1]!;
    assert.notEqual(current, first);
    assert.equal(alive(current), true);

    // (iv) disposal keeps its immediate shutdown.
    events.emit("agent/disposed", {});
    await sleep(150);
    assert.equal(alive(current), false, "disposal shuts the bridge immediately");
  } finally {
    delete process.env.FAKE_BRIDGE_PID_FILE;
    const maybe = (app as unknown as { dispose?: () => Promise<unknown> }).dispose;
    if (maybe !== undefined) await maybe.call(app);
  }
});

test("D019: a held lease prevents the reap while a request is in flight", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "norm-lease-"));
  const pidFile = path.join(dir, "pids.log");
  const app = await mountedIdleApp("pause-layout", pidFile);
  let heldPid = 0;
  try {
    const session = Session.create(SessionId("lease-a"), [], headerFor("lease-a", dir));
    const agent = { session } as unknown as Agent;
    const events = agentEvents(app, agent);
    events.emit("agent/created", { source: "startup" });
    // rc.6-line creation event: absent from the 0.2.0 event map, hence the
    // cast — same rationale as the host-compat seam subscription.
    events.emit("agent/session-start" as never, {} as never);
    // The pre-step refresh hangs on the paused layout response, holding a
    // bridge lease; do not await the waterfall to completion.
    const signal = new AbortController().signal;
    void events.waterfall(
      "agent/pre-step",
      { messages: [], turn: 1, step: 1, signal },
      () => Promise.resolve({ kind: "enter" as const, messages: [] }),
    ).catch(() => undefined);

    await sleep(250);
    const current = await pidsOf(pidFile);
    assert.ok(current.length >= 1, "fixture started");
    heldPid = current[current.length - 1]!;

    // Well past the TTL: the lease keeps busy() true, so no reap fires.
    await sleep(300);
    assert.equal(alive(heldPid), true, "in-flight lease prevents the reap");

    events.emit("agent/disposed", {});
    await sleep(150);
  } finally {
    delete process.env.FAKE_BRIDGE_PID_FILE;
    if (heldPid !== 0 && alive(heldPid)) process.kill(heldPid, "SIGKILL");
    const maybe = (app as unknown as { dispose?: () => Promise<unknown> }).dispose;
    if (maybe !== undefined) await maybe.call(app);
  }
});
