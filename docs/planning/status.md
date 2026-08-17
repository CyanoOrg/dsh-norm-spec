# Development Status

## Resume here

- Stage: post-beta.2. `0.1.0-beta.2` shipped 2026-08-17 (tag
  `v0.1.0-beta.2`, five @cyanoorg packages on npm, `beta` dist-tag).
  The beta.1 -> beta.2 arc: P4 registry E2E (clean `dsh plugin add`)
  found the packaged bundle patch still declaring the bare loader-entry
  name `dsh-norm-spec`, which made every registry install fail to boot;
  fixed by #6 (staged patch emits the scoped name) and promoted by #7.
  P4 re-verification against the published beta.2 passed with zero
  modifications: registry install, plugin boot, bridge start, `.norm`
  injection observed in the model-visible request, session completion.
- Upstream drift incident (2026-08-17): `@deepseek-ai` published the
  rc.7 line while beta.2 promotion was in flight; floating
  `^0.1.0-rc.6` transitive peers resolved into rc.7 and broke the
  staging smoke with ERESOLVE. devDependencies now pin the full
  transitive peer closure (17 packages) at rc.6. Lesson: during any
  promotion, re-run the staging smoke before publishing even if the
  only change is a version bump.
- `latest` dist-tag currently points at `0.1.0-beta.1` (registry
  forces latest creation on a new package's first publish; we do not
  fight it). The stable 0.1.0 release will be published WITHOUT
  `--tag` so latest lands on the stable version naturally; beta
  channel stays prerelease-only (`--tag beta`). Recorded in
  `docs/RELEASE-SOP.md`.
- Known open items, in order:
  1. P3 (this branch): status/ROADMAP/CHANGELOG release records, stable
     release SOP, CI actions v4 -> v5 hygiene.
  2. 0.1.0 stable: re-run P4 against published 0.1.0, then finish with
     a README pass.
- Hard constraints active: never write custom session event types (D003);
  no `PATH` fallback for the bridge (packaged resolution is live since
  D011; env override remains for development); enforcement subset empty
  (D006).

## Verification snapshot (2026-08-17, beta.2)

| Gate | Command | Result |
|---|---|---|
| Rust format | `cargo fmt --check` | green |
| Rust lint | `cargo clippy --workspace --all-targets --all-features -- -D warnings` | green |
| Rust tests | `cargo test --workspace --all-features` | 16 passed |
| `.norm` | `norm validate .norm --strict` | OK, 0 errors |
| TS typecheck | `npm run typecheck` | green |
| TS tests | `npm test` (typecheck + tests incl. staging regression guards) | green |
| Staging smoke | `scripts/check-staging-smoke.ts` (isolated consumer) | green |
| CI (PR #7) | cross-platform x4, candidates, quality gates | 9/9 green |
| P4 registry E2E | install beta.2 -> plugin boot -> injection -> session done | green, zero modifications |

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
