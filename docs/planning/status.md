# Development Status

## Resume here

- Stage: 0.1.0 stable promotion (branch `chore/promote-0.1.0`).
  The beta line is complete: beta.1 rehearsal (2026-08-16), beta.2
  registry-installable fix (2026-08-17, #6/#7) with P4
  zero-modification re-verification, and P3 release records + stable
  release SOP + CI actions on the Node 24 line merged (#8, 2026-08-18).
- This promotion is version-only: 0.1.0-beta.2 -> 0.1.0 across the
  workspace, npm manifests, and package candidates; no code changes.
  The 17-package rc.6 peer-closure pin from the 2026-08-17 upstream
  drift incident carries over unchanged, and the staging smoke is
  re-run on this branch per that incident's lesson (re-run it on every
  promotion even when the only change is a version bump).
- `latest` dist-tag currently points at `0.1.0-beta.1` (registry
  forces latest creation on a new package's first publish; we do not
  fight it). Publishing 0.1.0 WITHOUT `--tag` moves latest onto the
  stable version naturally; the beta channel stays prerelease-only.
  Recorded in `docs/RELEASE-SOP.md`.
- Known open items, in order:
  1. Merge this promotion, then human publish per
     `docs/RELEASE-SOP.md` (four platform packages first, root last,
     no `--tag`).
  2. P4 registry E2E re-run against the published 0.1.0.
  3. README pass (first public-facing readme for the 0.1.0 audience).
  4. Wrap-up records: verification snapshot refresh and ROADMAP stable
     milestone marked shipped.
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
| 0.1.0 promotion | all local gates + staging smoke re-run | green (2026-08-18, this branch) |

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
