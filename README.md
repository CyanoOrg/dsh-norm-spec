# dsh-norm-spec

DeepSeek Harness (dsh) Cordis plugin adapter for [norm-spec](https://github.com/CyanoOrg/norm-spec)
conventions: per-session `.norm` convention injection and soft post-edit
convention validation, backed by the canonical Rust engine.

**Status: `0.1.0-alpha.1` local development. DSH host pinned to
`@deepseek-ai/dsh@0.1.0-rc.6`. Not published.**

## What it does

- Starts one verified `dsh-norm-bridge` child per DSH agent session
  (`agent/session-start`) against a sealed upstream norm-spec payload.
- Injects collected `.norm` conventions at `agent/pre-step` as one durable
  `<system-reminder>` user message, SHA-1 digest-suppressed, most-specific
  first — the same injection idiom as dsh's own `agent-instructions`.
- After successful `write`/`edit` tool calls, appends bounded strict
  validation feedback through `tools/post-execute` (soft feedback; never
  blocks or reverts).
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

# Run the plugin in a real dsh checkout (after packaging exists):
# cordis.yml entry —
#   - id: norm
#     name: './packages/dsh-norm-spec'   # or published package name
#     config:
#       launch:
#         command: <bridge-binary>
#         args: ["serve", "--payload", <sealed-payload>]
```

Until packaging exists, the plugin resolves its runtime from
`DSH_NORM_BRIDGE` and `DSH_NORM_PAYLOAD` environment variables.

## Documentation

- `docs/ARCHITECTURE.md` — Rust/TypeScript boundary and DSH host surface
- `docs/BRIDGE-PROTOCOL.md` — `dsh-norm-spec/bridge/v1` process contract
- `docs/decisions.md` — decision records D001–D006
- `docs/planning/status.md` — live development state
- `ROADMAP.md` — milestone plan

## License

MIT
