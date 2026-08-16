# Changelog

All notable changes are documented here under `[Unreleased]` until release
preparation.

## [Unreleased]

## [0.1.0-beta.1] - 2026-08-16

First public distribution rehearsal (D011): five @cyanoorg npm packages.

### Added

- D010 governance: public repository, layered branch protection, strict CI
  (rust-quality, ts-quality, norm-validate), linear signed history.
- D011 distribution decision: five `@cyanoorg/dsh-norm-spec*` packages
  (root + four exact-version native optionalDependencies), human-only
  publication, `0.1.0-beta.1` first public version.
- Packaged runtime resolution (`src/runtime-resolver.ts`): root release.json
  identity -> platform-package locator -> version match -> safe relative
  bridge/payload paths; env overrides stay development-only.
- Package staging (`scripts/package-staging.ts`): deterministic five-package
  candidate assembly (compiled lib, packaged bundle patch without env launch,
  skills, release manifests, sealed upstream payload).
- Hosted candidate production (D011 P2): `package-candidates` workflow —
  root candidate, four-platform native candidates with checksum-verified
  upstream pins, and the aggregate five-package candidate set with a
  source-revision-bound inventory.

### Changed

- Version promoted 0.1.0-alpha.1 -> 0.1.0-beta.1 across the workspace,
  npm manifests, and package candidates.

### Constraints

- Never writes custom DSH session event types (D003).
- No `PATH` fallback for the bridge runtime.
- Hard enforcement subset is empty (D006); injection is guidance and
  validation is soft feedback only.


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
