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
  1. Real DSH rc.6 host verification (t8): plugin load via `cordis.yml`,
     one session with a sample `.norm` project, injection/validation/
     native tools observed end to end.
  2. Sealed-payload plumbing for local runs: build the bridge binary
     (`cargo build --release`) and point `DSH_NORM_BRIDGE`/`DSH_NORM_PAYLOAD`
     at a verified payload; today's tests only exercise the fake bridge.
  3. skills/dsh-norm-spec SKILL.md (pi-norm-spec D007 pattern) — directory
     exists, file not written.
  4. .github CI workflows — deferred with GitHub remote (D004).
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

## Decision index

D001 fork bridge; D002 DSH durable injection idiom; D003 no custom session
events; D004 rc.6 pin + local dev, publication deferred; D005 independent
0.1.0-alpha.1 line; D006 empty enforcement. See `docs/decisions.md`.
