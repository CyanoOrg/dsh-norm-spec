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
- Repository governance unified with the family (2026-08-18, D012):
  four active layered rulesets all `bypass_mode: none`;
  `main-quality` raised from three to nine strict required checks
  (cross-platform x4 + both candidate jobs now merge-blocking); wikis
  off; head branches never auto-deleted; `cyano-bot` back to Write
  via `norm-automation` (admin removed, verified by readback and a
  real push).
- Post-0.1.0 runtime review (2026-09-03) produced
  `docs/planning/target-context-plan.md`: a verified tracking defect
  (active target stays at the session root; DSH file tools take
  `file_path`, the adapter reads `path`), the injection-timing host
  boundary, and the approved dual-track direction for multi-directory
  scoping (adapter-side bounded multi-target now; batch collect proposed
  upstream in norm-spec `docs/planning/batch-collect-proposal.md`).
  Implementation workstreams start there; decision records precede each.
  The same-day timing discussion added: the static convention layout is
  enumerable via upstream `norm scan`, so the first-touch gap is closed
  educationally — a layout index injected through a `dsh-system-prompt`
  section (D-D), a repaired `norm_scan` backed by a new bridge `scan`
  method (F5/WS1.5; the tool currently fakes scan with collect and cannot
  see subdirectory conventions), and deny-until-informed recorded as
  viable but rejected with measurement-gated reopen conditions. Watch
  item 3 additionally covers the rc.7+ pre-execute context seam
  (target-context plan D-C).
- WS1/WS1.5 implemented on branch `fix/target-context` (2026-09-03,
  D013/D014): `file_path` tracking + directory normalization with unit
  tests and the `dsh-e2e-rescope.mjs` step-level E2E (re-scoping PASS
  against real rc.6); bridge `scan` method + repaired `norm_scan` verified
  against the sealed rc.1 payload live (65 directories, coverage intact).
- WS5/WS4 implemented on the same branch (2026-09-03, D015): bridge
  `layoutIndex` method (engine projection, live-verified against the
  sealed payload), the `dsh-norm-spec:layout-index` system-prompt section
  (order 150, digest-refreshed after `.norm` edits), Skill
  collect-before-work guidance, and first-touch debug measurement.
  E2E extended: the convention map appears in the system prompt from the
  step after the first fetch.
- WS2 implemented on the same branch (2026-09-03, D016): bridge
  `promptContextMulti` (strict target-set validation, serial fan-out,
  one token across spawns) + engine `prompt-context-multi/v1` merged
  projection (request-order scopes, most-specific-first within a scope,
  full content once with shared markers, 256 KiB fail-not-truncate) +
  adapter bounded recency set (max 4). Live-verified against the sealed
  payload on a 3-scope demo tree; rescope E2E extended and PASS through
  the real rc.6 agent loop. Gates green: fmt/clippy/test (29) +
  typecheck/test (33). Target-context plan workstreams complete; branch
  `fix/target-context` ready for review/PR.
- 0.2.0 promotion in progress (2026-09-03, branch
  `chore/promote-0.2.0`): workspace + six npm manifests at 0.2.0,
  intra-workspace bridge dependency raised to `0.2.0` (was
  `0.1.0-alpha.1`), CHANGELOG promoted, ROADMAP 0.2 noted. Staging smoke
  re-run required by the SOP before merge.
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
  single-slot replacement implemented 2026-08-15 (`1d08f67`), step-level
  E2E verified, shipped since 0.1.0-beta.1; D009 —
  one dsh-specific Skill registered at runtime from the plugin package;
  D010 — public GitHub repository with layered main governance; D011 —
  five-package @cyanoorg distribution under release-manager authority. See
  `docs/decisions.md`.
