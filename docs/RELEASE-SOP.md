# Release SOP (npm five-package distribution, D011)

Operational procedure for releasing the @cyanoorg dsh-norm-spec package
set. Authority: human release managers (`bravetwo`) executing local
signed `npm publish` with 2FA. CI builds and retains candidates only
and never holds npm credentials.

## Channels and dist-tags

| Channel | Tag | Rule |
|---|---|---|
| Prerelease (alpha/beta/rc) | `beta` | Always publish with `--tag beta` |
| Stable | `latest` (default) | **Publish WITHOUT `--tag`** |

### The `latest`-on-first-publish rule

The npm registry forces creation of a `latest` dist-tag pointing at a
new package's first publish, regardless of CLI intent. This is
server-side behavior and cannot be prevented. We do not fight it
(no `npm dist-tag rm latest`): with zero external users the mis-tag is
harmless, and the stable release fixes it naturally — publishing
0.1.0 without `--tag` moves `latest` to the stable version.

History: `latest` was force-created at `0.1.0-beta.1` (2026-08-16) and
intentionally left in place through beta.2 (2026-08-17).

## Preconditions

1. main is green: CI (ci.yml) and package-candidates.yml all pass on
   the release commit.
2. The staging smoke passes against the staged candidate set
   (version-bump promotions must re-run it — see the 2026-08-17
   upstream-drift incident).
3. Release record written: CHANGELOG entry, status.md "Resume here"
   updated, ROADMAP milestone noted.

## Procedure

1. Branch `chore/promote-<version>` from main.
2. Bump versions — `bash scripts/promote-version.sh <old> <new>`
   guards and updates all eight sites and verifies no residual old
   version string:
   - Workspace `Cargo.toml` + `cargo update --workspace`.
   - Root `package.json`, `packages/*/package.json` — **including the
     root's `optionalDependencies` cross-references to the platform
     packages** (the 2026-08-17 promotion initially missed these).
   - The intra-workspace engine pin in
     `crates/dsh-norm-bridge/Cargo.toml` (missed in 8dfe0f0, fixed by
     9dac5ca, and missed again in both the 0.2.2 and 0.2.3 promotions —
     this site recurs, hence the guard).
   - `package-lock.json` via `npm install --package-lock-only`.
3. CHANGELOG: promote `[Unreleased]` to `[<version>] - <date>`.
4. Gates: `npm test`, `cargo fmt --check`, `cargo clippy --workspace
   --all-targets --all-features -- -D warnings`, `cargo test --workspace
   --all-features`, staging smoke.
5. PR, review, ff-merge to main.
6. Tag `v<version>` (signed) and push.
7. CI package-candidates produces the five tarballs + inventory bound
   to the tag revision (push-triggered run on the release commit).
8. Download candidates from the green run and verify: sha256 against
   `inventory.json`, tarball contains `release.json` + `cordis.patch.yml`
   with the scoped loader-entry name.
9. Publish (human, 2FA):
   - `cd <candidates-dir>` first — **relative tarball paths must carry
     the `./` prefix** (`npm publish ./candidate-…/xxx.tgz`), otherwise
     npm parses the slash-path as a package spec and tries GitHub.
   - Order: four platform packages first, root last.
   - Prerelease: append `--tag beta` to every publish. Stable: no tag
     flag.
   - npm may hang at "Publishing to …" waiting for an OTP that doesn't
     render; pass `--otp=<code>` explicitly if needed.
10. Post-publish verification (P4): `node scripts/dsh-e2e-p4.mjs
    <exact-version> --layout-probe`. The script assembles a fresh
    DSH_HOME profile manually (`dsh plugin add` requires live LLM
    credentials and fails in credential-less environments, observed
    2026-10-29), installs the registry version, and asserts the
    convention injection reaches the model-visible request with zero
    bridge/payload env overrides. The layout section is legitimately
    absent from a single-turn request (D015 first-assembly timing; the
    multi-turn path is covered by the rescope suite); `--layout-probe`
    instead drives the installed packaged bridge's `layoutIndex`
    (payload: the `upstream` dir inside the same package). Zero
    modifications expected.
11. Create the GitHub Release for `v<version>` with that version's
    CHANGELOG section as the notes (plus the install command and npm
    package links). Mark `prerelease` for alpha/beta/rc; a stable
    release becomes the repo's "Latest". The tag already exists
    (step 6) — the release only attaches notes. Backfill any missing
    prior tags in the same sitting. Write the notes to a file and pass
    `--notes-file`; never inline notes in shell strings (observed
    2026-10-29: inline quoting produced a mangled body and a stray
    process).
12. Update status.md verification snapshot; note the release in
    ROADMAP; refresh the AGENTS.md current-state line.

## Known npm quirks (observed 2026-08-17)

- `npm whoami` may 401 after a fresh `npm login` session expires;
  re-login fixes it.
- The npm website org page lags the registry API after publishing
  (beta.1 took ~1h to appear; registry `npm view` is authoritative).
- pnpm (used by `dsh plugin add`) may resolve a dist-tag to a stale
  cached version; pin the exact version in verification installs to
  bypass metadata caches.
- `npm view` can serve a stale packument for minutes after a publish
  (CDN edge plus local cache): versions queried immediately may miss
  the new release and look unpublished. Re-query before concluding a
  publish failed — the npm website and a forced re-query are
  authoritative (observed 2026-10-01 on 0.2.1: four packages appeared
  missing for several minutes after a fully successful publish).
- The packument can also be complete while the tarball blobs lag: on
  0.2.2 (2026-10-29) two of five tarball URLs 404'd for ~5 minutes
  after a fully successful publish (dist records and registry
  signatures already present), blocking `pnpm install` with
  `ERR_PNPM_FETCH_404`. Both recovered without intervention — probe
  the tarball URL directly and wait before treating it as a failed
  publish.
- pnpm ≥ 11.21 auto-appends `minimumReleaseAgeExclude` entries to a
  profile's `pnpm-workspace.yaml` when installing fresh publishes
  (observed 2026-10-29 installing 0.2.3). Expected behavior — keep the
  entries; not an anomaly.
