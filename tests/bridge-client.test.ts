import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  BridgeClient,
  BridgeClientError,
  BridgeRequestCancelledError,
} from "../src/bridge-client.ts";

const fixture = fileURLToPath(new URL("./fixtures/fake-bridge.mjs", import.meta.url));

function launch(mode: string, onFailure?: (failure: BridgeClientError) => void) {
  return BridgeClient.start({
    command: process.execPath,
    args: [fixture, mode],
    startupTimeoutMs: 2_000,
    shutdownTimeoutMs: 2_000,
    onFailure,
  });
}

test("ready identity, request correlation, and graceful shutdown", async () => {
  const client = await launch("ready");
  assert.equal(client.getStatus().state, "ready");
  const status = await client.request<unknown>("status", {});
  assert.ok(typeof status === "object" && status !== null);
  await client.shutdown();
  assert.equal(client.getStatus().state, "stopped");
});

test("startupFailed rejects initialization without fallback", async () => {
  await assert.rejects(launch("startup-failure"), BridgeClientError);
});

test("AbortSignal cancels exactly the pending request", async () => {
  const client = await launch("ready");
  const controller = new AbortController();
  const pending = client.request<unknown>("collect", { root: ".", target: "." }, controller.signal);
  controller.abort();
  await assert.rejects(pending, BridgeRequestCancelledError);
  const status = await client.request<unknown>("status", {});
  assert.ok(typeof status === "object");
  await client.shutdown();
});

test("unexpected child exit rejects pending work and becomes failed state", async () => {
  let observed: BridgeClientError | undefined;
  const client = await launch("crash-after-ready", (failure) => {
    observed = failure;
  });
  await assert.rejects(
    client.request("collect", { root: ".", target: "." }),
    (error: unknown) => error instanceof BridgeClientError,
  );
  assert.equal(client.getStatus().state, "failed");
  assert.ok(observed);
});

test("malformed stdout fails startup instead of being ignored", async () => {
  await assert.rejects(launch("malformed"), BridgeClientError);
});
