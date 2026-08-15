# AGENTS.md

Entry point for humans and agents working on dsh-norm-spec.

## Purpose

dsh-norm-spec is the DeepSeek Harness (DSH) adapter for the canonical Rust
norm-spec engine. It provides per-session convention injection and post-edit
convention validation as a Cordis plugin, without becoming a second `.norm`
implementation.

DSH loads Cordis plugins as TypeScript. This repository is therefore
intentionally hybrid:

- Rust owns policy evaluation and the bridge protocol.
- TypeScript owns DSH event adaptation (Cordis `ctx.on` / `ctx.tools`).
- norm-spec owns parsing, collection, schema validation, and format
  semantics.

## Current state

Version `0.1.0-alpha.1` pre-release development identity. The repository
was bootstrapped 2026-08-15 by forking the verified pi-norm-spec bridge
(D001). Local development only; no GitHub remote yet (D004). DSH host
pinned to `@deepseek-ai/dsh@0.1.0-rc.6`.

Read first:

- `docs/planning/status.md` for live state.
- `docs/ARCHITECTURE.md` for code boundaries.
- `docs/BRIDGE-PROTOCOL.md` for the process contract.
- `docs/decisions.md` for immutable decisions.

## Common commands

```bash
cargo fmt --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace --all-features
cargo doc --workspace --no-deps
npm install
npm run typecheck
npm test
```

## Sources of truth

| Concern | Source of truth |
|---|---|
| project workflow and quality gates | `AGENTS.md` |
| adapter architecture | `docs/ARCHITECTURE.md` |
| TypeScript/Rust process protocol | `docs/BRIDGE-PROTOCOL.md` |
| rationale | `docs/decisions.md` |
| milestones | `ROADMAP.md` |
| shipped changes | `CHANGELOG.md` |
| in-flight state | `docs/planning/status.md` |
| bridge protocol verification | `tests/contract/` and bridge tests |
| `.norm` format and semantics | upstream `norm-spec` |

## Work loop

plan → decide → implement → test → review → merge → archive → release
review → release.

Non-trivial scope, protocol, enforcement, security, or distribution
decisions require a decision record before implementation. A green
regression suite is a merge gate, not proof that a release is complete.

## Branching and commits

Use trunk-based development. `main` stays releasable. Use short-lived
`feat/*`, `fix/*`, `docs/*`, `refactor/*`, `test/*`, and `chore/*`
branches. Bootstrap commits may land directly on `main`; subsequent
non-trivial work uses a short-lived branch.

Use Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`,
`chore:`, `perf:`, `build:`, and `ci:`. Each commit has one semantic
purpose. Stage files explicitly; never use `git add -A`. Run
`git diff --cached --check` before committing.

## Versioning and releases

dsh-norm-spec has independent Semantic Versioning starting at
`0.1.0-alpha.1`. Forked code from pi-norm-spec carries this repository's
identity (D005).

- Release tag: `vX.Y.Z` on `main`.
- Rust workspace and npm package versions must match in a release commit.
- Commit both `Cargo.lock` and `package-lock.json`.
- Pin the Rust development toolchain and define MSRV before public alpha.
- Declare compatible norm-spec product and machine protocol ranges
  explicitly.
- npm publication is deferred per D004.

## Rust rules

- Forbid unsafe code workspace-wide unless an explicit audited decision
  says otherwise.
- `dsh-norm-engine` owns framework-neutral policy decisions over
  normalized upstream data.
- `dsh-norm-bridge` owns JSON/JSONL framing and process lifecycle.
- Libraries do not exit the process, write terminal output, or hide
  failures.
- Production code avoids `unwrap` and `expect` for recoverable failures.
- Structured outputs are versioned and deterministic.

## TypeScript rules

- Keep `src/` thin: event registration, input projection, bridge calls,
  cancellation, and user-facing messages only.
- Do not parse YAML, walk `.norm` inheritance, validate schemas, or
  duplicate policy evaluation in TypeScript.
- Use strict TypeScript with no implicit `any`.
- Never swallow bridge errors or convert them into an empty active
  ruleset.

## DSH-specific rules

- Never append custom session event types (D003; upstream Discussion
  #1584).
- Model-visible output uses standard user messages and tool results only.
- The plugin must boot and fail visibly when the sealed runtime payload
  is missing; no `PATH` fallback.
