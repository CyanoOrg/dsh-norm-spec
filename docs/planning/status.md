# Development Status

## Resume here

- Stage: local pre-release development of `0.1.0-alpha.1`. The repository was
  bootstrapped on 2026-08-15 by forking the verified pi-norm-spec bridge
  (D001). No GitHub remote yet (D004); DSH host pinned to
  `@deepseek-ai/dsh@0.1.0-rc.6` from npm (GitHub master lags npm at rc.5;
  npm tarballs are the plugin-API authority).
- Rust fork is complete and green: `dsh-norm-engine` + `dsh-norm-bridge`
  build, clippy, and 16 tests pass under workspace lints after namespace
  rename (including the assets-embedded `dsh-norm-spec/upstream-pin/v1`
  fix caught by tests).
- TypeScript plugin exists (`src/index.ts`, `src/bridge-client.ts` forked,
  `src/validation-feedback.ts` adapted, `src/runtime-resolver.ts`,
  `src/native-tools.ts`): applies `agent/session-start`/`agent/disposed`
  bridge lifecycle, `agent/pre-step` durable `<system-reminder>` injection
  with SHA-1 digest suppression (D002), `tools/post-execute` soft
  validation feedback serialized FIFO per session, and
  `norm_validate`/`norm_collect`/`norm_scan` native tools on `ctx.tools`.
  `tools/result` tracks the active target from read/write/edit paths.
- TypeScript suite green: bridge-client tests (5) against the ported
  fake-bridge fixture; `npm test` = typecheck + tests. Fake-bridge modes
  are `startup-failure`/`crash-after-ready` (not `startup-failed`/`crash`
  — mismatch hangs the runner; that was diagnosed 2026-08-15).
- Known open items, in order:
  1. Single-slot replacement (D008 follow-up): verify a plugin can emit a
     session `surfaceOp` replace (strict `sourceEventSeqs` provenance);
     raise an upstream helper request if the path is not plugin-accessible.
  2. Post-edit validation E2E: the stub-LLM run proves injection; a
     follow-up run should drive a write/edit tool call and observe the
     `tools/post-execute` feedback in the next model request.
  3. lib/ build pipeline: the E2E used a hand-built lib/ (tsc + sed for
     .ts -> .js import suffixes). Package a reproducible build script
     before any distribution (D004 blocks npm anyway).
  4. skills/dsh-norm-spec SKILL.md (pi-norm-spec D007 pattern) — directory
     exists, file not written.
  5. .github CI workflows — deferred with GitHub remote (D004).
- E2E verified 2026-08-15 (scripts/dsh-e2e-stub.mjs): real dsh 0.1.0-rc.6
  CLI, headless profile, bundle-patch plugin install (pnpm file:), stub
  SSE LLM asserting the `.norm` `<system-reminder>` arrives in the
  model-visible turn. Bridge readiness race at pre-step was found and
  fixed in that run (await startBridgeFor, per-session starting guard).
- Hard constraints active: never write custom session event types (D003);
  no `PATH` fallback for the bridge (runtime-resolver env vars only until
  packaging exists); enforcement subset empty (D006).

## Verification snapshot (2026-08-15)

| Gate | Command | Result |
|---|---|---|
| Rust format | `cargo fmt --check` | green |
| Rust lint | `cargo clippy --workspace --all-targets --all-features -- -D warnings` | green |
| Rust tests | `cargo test --workspace --all-features` | 16 passed |
| `.norm` | `norm validate .norm --strict` | OK, 0 errors |
| TS typecheck | `npm run typecheck` | green |
| TS tests | `npm test` (typecheck + 5 bridge tests) | green |
| Cordis smoke | `scripts/cordis-smoke.mjs` | green (mount, tools, round-trips) |
| dsh E2E | `scripts/dsh-e2e-stub.mjs` | green (injection reaches model request) |

## Decision index

- D001 — fork bridge; D002 — DSH durable injection idiom; D003 — no custom
  session events; D004 — rc.6 pin + local dev, publication deferred; D005 —
  independent 0.1.0-alpha.1 line; D006 — empty enforcement; D007 — ambient
  bridge for agent-less tool calls; D008 — durable injection stays,
  single-slot replacement approved as the bounded-occupancy follow-up. See
  `docs/decisions.md`.
