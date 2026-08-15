# Changelog

All notable changes are documented here under `[Unreleased]` until release
preparation.

## [Unreleased]

### Added

- Independent `0.1.0-alpha.1` product line for the DeepSeek Harness (dsh)
  norm-spec adapter (D005).
- Repository governance: `AGENTS.md`, `.norm` (strict-validated), decision
  records D001–D006, architecture and bridge-protocol documents.
- `dsh-norm-engine` and `dsh-norm-bridge` Rust crates forked from
  pi-norm-spec with the `dsh-norm-spec` namespace: sealed-payload
  verification, compatibility discovery, collect, validate, and the
  `dsh-norm-spec/bridge/v1` JSONL process contract.
- TypeScript Cordis plugin skeleton: session-scoped bridge lifecycle,
  `agent/pre-step` durable convention injection with SHA-1 digest
  suppression, `tools/post-execute` soft validation feedback, active-target
  tracking from first-party fs tool calls.
- Development-only runtime resolution via `DSH_NORM_BRIDGE` /
  `DSH_NORM_PAYLOAD` environment variables.

### Constraints

- Never writes custom DSH session event types (D003).
- No `PATH` fallback for the bridge runtime.
- Hard enforcement subset is empty (D006); injection is guidance and
  validation is soft feedback only.
