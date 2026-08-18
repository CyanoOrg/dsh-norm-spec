# dsh-norm-spec

DeepSeek Harness (dsh) Cordis plugin adapter for [norm-spec](https://github.com/CyanoOrg/norm-spec)
conventions: per-session `.norm` convention injection and soft post-edit
convention validation, backed by the canonical Rust engine.

## Why

Conventions only matter if they reach the agent while it works. A validated
`.norm` tree on disk is inert by itself; the common workaround — an
always-resident instruction file — spends tokens re-establishing the same
ambiguity while its effectiveness decays with distance and competing
context.

This adapter delivers convention knowledge the way a cache wants it:

> Page the conventions that apply to the current working directory into
> the agent's perception at action time, and check edits against them
> afterward.

Delivery is host-specific. On DSH rc.6 the only injection seam
(`agent/pre-step`) writes into the session log, so the reminder is
durable: injected once, suppressed while unchanged (SHA-1 digest), and —
when the collected conventions change — **superseded in place through a
single slot** (`surfaceOp` replace). The model never carries stale
conventions and occupancy stays bounded no matter how long the session
drifts across directories. The same format and semantics run under a
different host in [pi-norm-spec](https://github.com/CyanoOrg/pi-norm-spec)
— the delivery layer is the host-specific part, and that boundary is the
point.

**Status: `0.1.0` stable, published to npm as
[`@cyanoorg/dsh-norm-spec`](https://www.npmjs.com/package/@cyanoorg/dsh-norm-spec).
DSH host supported: `@deepseek-ai/dsh@0.1.0-rc.6`.**

## Install

```bash
dsh plugin add @cyanoorg/dsh-norm-spec --profile <name>
```

That is all: the package ships a sealed upstream norm-spec payload and a
native bridge, resolved at runtime from the installed tree — no PATH
lookups, no environment variables. Platform binaries arrive through npm
`optionalDependencies` (`darwin-arm64`, `darwin-x64`, `linux-x64`,
`win32-x64`); npm selects the matching one automatically.

## What it does

- Starts one verified `dsh-norm-bridge` child per DSH agent session
  (`agent/session-start`) against a sealed upstream norm-spec payload.
- Injects collected `.norm` conventions at `agent/pre-step` as one durable
  `<system-reminder>` user message, most-specific first — the same
  injection idiom as dsh's own `agent-instructions`. The reminder occupies
  at most one session-surface slot: unchanged conventions are
  digest-suppressed, changed ones supersede the previous reminder in
  place (single-slot replacement, D008).
- After successful `write`/`edit` tool calls, appends bounded strict
  validation feedback through `tools/post-execute` (soft feedback; never
  blocks or reverts).
- Registers native `norm_validate` / `norm_collect` / `norm_scan` tools
  and one `dsh-norm-spec` skill so the model can inspect conventions on
  demand.
- Never writes custom session event types; never falls back to a `norm`
  on `PATH`.

## Local development

```bash
# Rust gates
cargo fmt --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace --all-features

# TypeScript
npm install
npm run typecheck
npm test
```

Development may override the packaged runtime resolution with
`DSH_NORM_BRIDGE` and `DSH_NORM_PAYLOAD` environment variables;
packaged installs never use them. Release procedure (five-package
publish, dist-tag policy, post-publish verification) lives in
`docs/RELEASE-SOP.md`.

## Documentation

- `docs/ARCHITECTURE.md` — Rust/TypeScript boundary and DSH host surface
- `docs/BRIDGE-PROTOCOL.md` — `dsh-norm-spec/bridge/v1` process contract
- `docs/decisions.md` — decision records D001–D012
- `docs/RELEASE-SOP.md` — release and publish procedure
- `docs/planning/status.md` — live development state
- `ROADMAP.md` — milestone plan

## License

MIT
