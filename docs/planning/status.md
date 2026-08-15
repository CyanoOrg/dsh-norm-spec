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
  `src/validation-feedback.ts` adapted, `src/runtime-resolver.ts`): applies
  `agent/session-start`/`agent/disposed` bridge lifecycle,
  `agent/pre-step` durable `<system-reminder>` injection with SHA-1 digest
  suppression (D002), and `tools/post-execute` soft validation feedback
  serialized FIFO per session. `tools/result` tracks the active target from
  read/write/edit paths.
- Known open items, in order:
  1. `npm run typecheck` last run was dirty; the final round of fixes
     (`exec.arguments`, `form: "notice"` requiring `summary`, value-form
     accept feedback path) is not yet re-verified. Restart here.
  2. Native tools (`norm_validate`, `norm_collect`, `norm_scan`) are not yet
     registered on `ctx.tools`.
  3. No TS tests yet; tests/extension fixtures (fake bridge) still to port.
  4. Git not initialized; all bootstrap work is uncommitted.
  5. Real DSH rc.6 host verification (t8) not started: plugin load via
     `cordis.yml`, one session with a sample `.norm` project.
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
| TS typecheck | `npm run typecheck` | **not green at last run** |

## Decision index

D001 fork bridge; D002 DSH durable injection idiom; D003 no custom session
events; D004 rc.6 pin + local dev, publication deferred; D005 independent
0.1.0-alpha.1 line; D006 empty enforcement. See `docs/decisions.md`.
