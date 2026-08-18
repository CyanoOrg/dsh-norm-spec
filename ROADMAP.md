# Roadmap

## 0.1 — Initial Rust-backed DSH plugin

### Alpha

- Repository governance, architecture, and bridge contracts (done 2026-08-15).
- Rust engine + bridge forked from pi-norm-spec with the dsh-norm-spec
  namespace (done 2026-08-15, 16 tests green).
- Thin TypeScript Cordis plugin: bridge lifecycle, pre-step convention
  injection, post-edit validation feedback (in progress).
- Native tools `norm_validate` / `norm_collect` / `norm_scan`.
- TS test suite with a fake-bridge fixture.
- Real DSH rc.6 host verification: plugin loads from `cordis.yml`, one
  session against a sample `.norm` project, injection and validation
  observed.
- Local-only distribution story: `DSH_NORM_BRIDGE` + `DSH_NORM_PAYLOAD`
  environment resolution (no `PATH` fallback).

### Beta — SHIPPED 2026-08-17 (0.1.0-beta.2)

- Packaged distribution following pi-norm-spec D012: platform-optional npm
  packages bundling the sealed upstream payload and bridge binary.
  Shipped as the five @cyanoorg packages (D011), beta.1 rehearsal
  2026-08-16, beta.2 (registry-installable) 2026-08-17; P4 registry E2E
  verified zero-modification against published beta.2.
- Release manifests binding package version, source revision, and the exact
  upstream release asset.
- Public repository + hosted CI (unblocked by D011 superseding D004's
  publication-deferral trigger; CI green and required by main-quality).

### Stable — SHIPPED 2026-08-18 (0.1.0)

- Version-only promotion from beta.2 (staging smoke re-run green per
  the 2026-08-17 incident lesson), signed tag `v0.1.0`, human publish
  without `--tag` so `latest` landed on stable across all five
  packages, P4 registry E2E green against the published 0.1.0, public
  README pass.
- Host Adapter SDK convergence with pi-norm-spec (extraction planned after
  this second adapter completes; see 2026-08-14 strategy discussion §7).
- Enforcement reopened only under D006's prerequisites.

## Beyond 0.1

- Track upstream Discussion #1584 (session event registration surface);
  revisit D003 only if it ships.
- Watch the DSH plugin ecosystem (`dsh-plugin` topic) for injection-pattern
  evolution that D002 should track.
