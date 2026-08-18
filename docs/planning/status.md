# Development Status

## Resume here

- Stage: **0.1.0 stable shipped** (2026-08-18). Full arc: promotion
  PR #9 (CI 9/9, staging smoke re-run green) -> ff merge `276f0e7` ->
  signed tag `v0.1.0` -> candidates run bound to the tag revision ->
  human publish of the five @cyanoorg packages without `--tag` ->
  `latest` landed on 0.1.0 across all five (verified via registry
  `npm view`), `beta` stays at 0.1.0-beta.2 -> P4 registry E2E green
  against the published 0.1.0 (fresh DSH_HOME, registry install, no
  env overrides, injection observed in the model-visible request).
  This wrap-up branch carries the public README pass.
- Known open items, in order:
  1. Post-0.1.0 planning: Host Adapter SDK convergence with
     pi-norm-spec (extraction waits on pi E3/E4).
  2. CI hygiene minor: replace `upload-artifact@v5` (forced to Node 24
     by the runner; deprecation warning in the release candidates run).
  3. Upstream watch: DSH rc line drift (rc.7 exists; we stay pinned at
     rc.6 per the peer-closure pin until a deliberate host bump).
- Hard constraints active: never write custom session event types (D003);
  no `PATH` fallback for the bridge (packaged resolution is live since
  D011; env override remains for development); enforcement subset empty
  (D006).

## Verification snapshot (2026-08-18, 0.1.0)

| Gate | Command | Result |
|---|---|---|
| Rust format | `cargo fmt --check` | green |
| Rust lint | `cargo clippy --workspace --all-targets --all-features -- -D warnings` | green |
| Rust tests | `cargo test --workspace --all-features` | 16 passed |
| `.norm` | `norm validate .norm --strict` | OK, 0 errors |
| TS typecheck | `npm run typecheck` | green |
| TS tests | `npm test` (typecheck + tests incl. staging regression guards) | green |
| Staging smoke | `scripts/check-staging-smoke.ts` (isolated consumer) | green |
| CI (PR #9) | cross-platform x4, candidates, quality gates | 9/9 green |
| 0.1.0 promotion | all local gates + staging smoke re-run | green (2026-08-18) |
| Candidates (tag run) | sha256 x5 sidecar + inventory cross-check, scoped loader-entry name | green, revision `276f0e7` |
| Publish | five packages, no `--tag` | done; `latest` -> 0.1.0 on all five |
| P4 registry E2E | install 0.1.0 -> plugin boot -> injection -> session done | green, zero modifications |

## Decision index

- D001 — fork bridge; D002 — DSH durable injection idiom; D003 — no custom
  session events; D004 — rc.6 pin + local dev, publication deferred; D005 —
  independent 0.1.0-alpha.1 line; D006 — empty enforcement; D007 — ambient
  bridge for agent-less tool calls; D008 — durable injection stays,
  single-slot replacement approved as the bounded-occupancy follow-up; D009 —
  one dsh-specific Skill registered at runtime from the plugin package;
  D010 — public GitHub repository with layered main governance; D011 —
  five-package @cyanoorg distribution under release-manager authority. See
  `docs/decisions.md`.
