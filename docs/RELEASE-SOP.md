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
2. Bump versions:
   - Workspace `Cargo.toml` + `cargo update --workspace`.
   - Root `package.json`, `packages/*/package.json` — **including the
     root's `optionalDependencies` cross-references to the platform
     packages** (the 2026-08-17 promotion initially missed these).
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
10. Post-publish verification (P4): fresh `dsh plugin --profile web
    add @cyanoorg/dsh-norm-spec@<exact-version-or-tag>` in a clean
    DSH_HOME, then the stub-LLM E2E asserting injection reaches the
    model-visible request. Zero modifications expected.
11. Create the GitHub Release for `v<version>` with that version's
    CHANGELOG section as the notes (plus the install command and npm
    package links). Mark `prerelease` for alpha/beta/rc; a stable
    release becomes the repo's "Latest". The tag already exists
    (step 6) — the release only attaches notes. Backfill any missing
    prior tags in the same sitting.
12. Update status.md verification snapshot; note the release in
    ROADMAP.

## Known npm quirks (observed 2026-08-17)

- `npm whoami` may 401 after a fresh `npm login` session expires;
  re-login fixes it.
- The npm website org page lags the registry API after publishing
  (beta.1 took ~1h to appear; registry `npm view` is authoritative).
- pnpm (used by `dsh plugin add`) may resolve a dist-tag to a stale
  cached version; pin the exact version in verification installs to
  bypass metadata caches.
