# Changelog

All notable changes are documented here under `[Unreleased]` until release
preparation.

## [Unreleased]

## [0.1.0] - 2026-08-18

First stable release of the dsh adapter.

### Changed

- Version promoted 0.1.0-beta.2 -> 0.1.0 across the Rust workspace,
  npm manifests, and package candidates. No code changes since
  0.1.0-beta.2; the packaging fix and the 17-package rc.6 peer-closure
  pin from beta.2 carry over unchanged.
- Stable publish executes without `--tag` so the `latest` dist-tag
  moves from 0.1.0-beta.1 to 0.1.0 (the registry force-created
  `latest` on the first publish; see docs/RELEASE-SOP.md). The
  `beta` dist-tag remains on the prerelease line.

## [0.1.0-beta.2] - 2026-08-17

Packaging fix release: the packaged bundle patch now carries the scoped
loader-entry name, unblocking registry installs (P4 finding).

### Fixed

- Packaged `cordis.patch.yml` emitted by `scripts/package-staging.ts`
  referenced the plugin by the bare name `dsh-norm-spec`; the dsh loader
  resolves loader-entry names as import specifiers from the profile
  directory, so every registry install (`dsh plugin add
  @cyanoorg/dsh-norm-spec`) failed to boot with "Cannot find package
  'dsh-norm-spec'". The patch now emits the scoped publish name
  `@cyanoorg/dsh-norm-spec`. The dev E2E (file: install) had masked the
  mismatch via the profile-local bundle patch path.

### Added

- `tests/package-staging.test.ts`: pins the packaged-patch generator
  output and asserts every `packages/*/package.json` manifest stays
  scoped (regression guard for the D011 rename class).
- `scripts/check-staging-smoke.ts` derives tarball names from the staged
  manifests instead of the hardcoded `0.1.0-alpha.1`.

### Changed

- Version promoted 0.1.0-beta.1 -> 0.1.0-beta.2 across the workspace,
  npm manifests, and package candidates.
- The full transitive `@deepseek-ai` peer closure (17 packages) is now
  pinned to the DSH host rc.6 line in devDependencies: upstream
  published `0.1.0-rc.7` during this promotion and floating
  `^0.1.0-rc.6` peers started resolving into the rc.7 line, breaking
  the staging smoke with ERESOLVE peer conflicts.

## [0.1.0-beta.1] - 2026-08-16

First public distribution rehearsal (D011): five @cyanoorg npm packages.

### Added

- Single-slot convention replacement via session surface replace
  (implemented 2026-08-15, first published in this version): the
  convention reminder occupies at most one surface message, superseded
  in place through a `surfaceOp` replace with `sourceEventSeqs`
  provenance when collected conventions change; step-level E2E
  (`scripts/dsh-e2e-slot.mjs`) verified replacement — exactly one
  reminder carrying the revised text — against the real host.
  (Backfilled 2026-08-18: the feature shipped in every published
  version but had no changelog entry.)

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
