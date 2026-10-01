# Host Sync Plan: DSH Compat Window 0.1.0-rc.6 -> 0.2.0-rc.2 (rev.2)

Planning input from the 2026-09-25 upstream review (rev.1, target
0.1.5-rc.3; never executed) re-evaluated on 2026-10-01 after the upstream
`latest` moved to the 0.2 line. The rev.1 findings were re-verified
directly against the `dsh-v0.2.0-rc.2` tag in the local
deepseek-harness clone (fetched 2026-10-01), plus live observation on the
upgraded local host. A decision record (D017) still precedes any
version lift, per the repository update order.

## Findings

### H1 — npm `latest` moved to 0.2.0-rc.2; the local host followed

- `@deepseek-ai/dsh` dist-tags: `latest` = `next` = `0.2.0-rc.2`
  (checked 2026-10-01). The 0.1.5-rc.3 window of rev.1 was never shipped
  into our packages; upstream overtook it.
- The local GUI host now runs 0.2.0-rc.2; the local E2E host
  (`/tmp/dsh-e2e`) was already refreshed to 0.2.0-rc.2.
- Drift since our rc.6 pin now spans six host lines
  (0.1.0-rc.7/rc.8, 0.1.1, 0.1.2/0.1.3 alphas, 0.1.5, 0.1.6/0.1.7,
  0.2.0-rc.x).

### H2 — The plugin API surface is unchanged through 0.2.0-rc.2

Re-verified at the `dsh-v0.2.0-rc.2` tag for every API we consume:

| Adapter usage (`src/`) | 0.2.0-rc.2 status |
|---|---|
| `agent/session-start`, `agent/disposed` | present, payload unchanged |
| `agent/pre-step` | payload `{agent, messages, signal}` unchanged; additive `turn`/`step` |
| `tools/result` | emit mode, `(exec, result)` unchanged |
| `tools/post-execute` | `(exec, result, next)` unchanged; `PostToolDecision` identical field-for-field |
| services `tools`/`skills`/`systemPrompt` | names, `register()`, `section({name, order, text})` unchanged |
| `SkillRegistration` (D009) | type definition identical |
| cordis `^4.0.1` | satisfied by vendored 4.0.4 |

448 commits between 0.1.7-rc.2 and 0.2.0-rc.2 contain no
plugin-surface breaking change (the breaking markers are host-internal).

### H3 — Live evidence: one beta-era plugin build spans five host lines

The local web profile still runs the published plugin **0.1.0-beta.2**
(see H8) on the 0.2.0-rc.2 host, and it operates: session injection
architecture, the native norm tools, and the Skill registration were
all observed working in-session on 2026-10-01. A single pre-D014 build
working across rc.6-era through 0.2.0-rc.2 is the strongest stability
evidence yet for the consumed surface.

### H4 — Peer ranges need a dual arm to reach 0.2.0-rc.2

Under node-semver's prerelease rule (a prerelease version only matches
through a same-`[major,minor,patch]`-tuple prerelease comparator),
`0.2.0-rc.2` satisfies neither `^0.1.0-rc.6` nor a single
`>=0.1.0-rc.6 <0.3.0`. The range that expresses the window is:

```
>=0.1.0-rc.6 <0.3.0 || >=0.2.0-rc.1 <0.3.0
```

This keeps the rc.6 floor, admits every released 0.1.x/0.2.x, admits
the verified 0.2.0-rc line, and deliberately excludes untested
`0.2.1-rc.x`/`0.3.x` prereleases until a future deliberate sync.

### H5 — Support packages drifted (minor, compatible)

cordis 4.0.1 -> 4.0.4; cordis-plugin-loader 1.0.2 -> 1.0.5 (vendored
upstream). Both semver-compatible; the packaging contract is re-verified
by the staging smoke and registry E2E.

### H6 — dsh 0.2.0 manages plugin compatibility visibly

0.2.0 ships plugin-manager compatibility handling: the profile keeps a
`compatibility.json` mapping installed plugin versions to host
versions, and the plugin manager prompts reinstalls for incompatible
plugins. Consequence: our peerDependencies range is no longer
documentation — it feeds a user-facing compatibility signal. The H4
fix is therefore user-visible, not cosmetic.

### H7 — The E2E harness breaks on 0.2.0 (LLM wire protocol); local adaptation is in flight

- dsh 0.2.0's `llm-deepseek` speaks the Anthropic Messages SSE event
  protocol (`message_start` / `content_block_*` / `message_stop`),
  not OpenAI chat.completion.chunk. The adapter itself is LLM-agnostic
  (agent/session events and tools only) and needs no change; the three
  E2E scripts (`dsh-e2e-stub`, `dsh-e2e-slot`, `dsh-e2e-postedit`)
  needed stub-server rewrites.
- Uncommitted adaptations for all three exist in the working tree
  (2026-10-01); they are unreviewed and ungated. WS-HS2 adopts them.
- The staged runtime (`.local-runtime/stage`) is a stale build — its
  bridge prints `0.1.0-alpha.1` while the Cargo workspace is 0.2.0 —
  and must be regenerated before any E2E run.

### H8 — Local profile runs a two-releases-stale plugin (ops)

The web profile pins `@cyanoorg/dsh-norm-spec@0.1.0-beta.2`. Its
`norm_scan` is the pre-D014 substitute and misreports root-only
projects — observed live on 2026-10-01: scan reported "No .norm
conventions found" for this repository while `norm_collect` and
`norm_validate` correctly see the root `.norm`. This is a stale
install, not a code defect. Refresh the profile to the published 0.2.1
(or staged tarball) after release and re-run the live tool smoke.

## Direction (approved 2026-09-25; ceiling re-targeted 2026-10-01)

- **HS-A Compat window, not a floor raise.** Supported host window:
  `0.1.0-rc.6` through `0.2.0-rc.2`. Floor stays rc.6. Anything newer
  (`0.2.0-rc.3+`, 0.2.0 final, 0.3) is smoke-only until the next
  deliberate sync.
- **HS-B Dual-arm peer range** (H4) in `package.json` and
  `packages/root/package.json` for the five `@deepseek-ai/dsh-*`
  peers; cordis stays `^4.0.1`.
- **HS-C Dev/CI target line rises to 0.2.0-rc.2.** Lockfile, staging
  runtime, and the primary verification path track npm `latest`; the
  rc.6 floor stays continuously verified (WS-HS4).
- **HS-D Out of scope, separately decided.**
  1. `PostToolDecision.additionalContexts` as the D006 feedback
     channel — 0.3.0 candidate, own decision record; exists since
     rc.6, decoupled from this sync.
  2. D-C reopen — `tools/pre-execute` remains a pure allow/deny/ask
     gate; timing posture unchanged.
  3. Upstream Discussion #1584 watch (D003) unchanged.
  4. No adapter changes for the 0.2.0 LLM protocol shift — only the
     E2E stub harness changes.

## Workstreams

### WS-HS1 — D017 decision record (before implementation)

Supersedes D004's pin clause only: the window (HS-A), the dual-arm peer
semantics with the node-semver rationale (HS-B/H4), the dev/CI target
(HS-C), the non-goals (HS-D), and a note that peer ranges now feed the
host's plugin-compatibility surface (H6).

### WS-HS2 — Version lift, stage regen, E2E-harness adoption

Branch `chore/host-sync-0.2.0-rc.2`.

- devDependencies: the rc.6 pack -> 0.2.0-rc.2 (fourteen
  `@deepseek-ai/*` packages); cordis 4.0.4; loader 1.0.5. Commit
  `package-lock.json`.
- Regenerate `.local-runtime/stage` (current build prints
  `0.1.0-alpha.1`; workspace is 0.2.0 — H7).
- Adopt the three in-flight E2E script adaptations after review
  (LLM stub protocol rewrite; content-driven routing for the title
  request shape change). They run only after the stage regen.
- Gates: `cargo fmt --check`; clippy `-D warnings`; `cargo test`;
  `npm run typecheck` (compile-time proof of H2 against real
  0.2.0-rc.2 types); `npm test`; staging smoke.

### WS-HS3 — E2E against the real 0.2.0-rc.2 host

- `/tmp/dsh-e2e` already hosts dsh 0.2.0-rc.2; run the rescope /
  slot / postedit suites against it with the regenerated stage bridge
  and the adapted scripts.
- P4-style registry E2E for the staged 0.2.1 packages on the
  0.2.0-rc.2 host (fresh `DSH_HOME`, registry install, no env
  overrides).
- The rev.1 idea of a separate 0.1.5-rc.3 leg is dropped: 0.2.0-rc.2
  verification supersedes it within the same surface.

### WS-HS4 — CI floor verification

- `ci.yml` gains a `host-floor` job: install the rc.6 peer pack over
  the checkout, then `typecheck` + `npm test`. Keeps the floor
  compile- and unit-verified on every push.
- The job joins `main-quality` as required (D012 governance edit via
  `norm-automation`; 9 -> 10 required checks).
- Default: no middle legs (0.1.1/0.1.5); matrix stays floor + latest.

### WS-HS5 — Docs, `.norm`, release, and profile refresh

- Root `.norm`: hard-constraint line "DSH host surface pinned to
  0.1.0-rc.6 until D004 reopens" -> a window statement citing D017;
  gate `norm validate .norm --strict`.
- `README.md` + `README.zh-CN.md` in the same commit: host
  compatibility statement gains the window.
- `AGENTS.md` (Current state), `docs/ARCHITECTURE.md`,
  `ROADMAP.md`, `docs/planning/status.md`, `CHANGELOG.md` at
  release.
- Release **0.2.1** in five-package lockstep (D011): peer-range
  widening, dev-dep lift, and E2E-harness infra are patch-level; no
  runtime behavior change; `productCompat =0.1.0-rc.1` untouched
  (WS3 owns it). Normal arc: promotion PR -> 10/10 checks -> ff merge
  -> signed tag `v0.2.1` -> candidates -> human publish.
- Post-publish ops (H8): upgrade the local web profile plugin off
  0.1.0-beta.2, confirm the profile's `compatibility.json` records
  the new pair, re-run the live tool smoke (`norm_scan` must report
  the root `.norm`).

## Acceptance

| Gate | Evidence |
|---|---|
| Rust | fmt / clippy / test green on the WS-HS2 branch |
| TypeScript | typecheck + `npm test` green against 0.2.0-rc.2 types |
| `.norm` | `norm validate .norm --strict`, 0 errors after WS-HS5 |
| Staging | smoke green on the regenerated stage; bridge prints 0.2.x |
| E2E | rescope / slot / postedit suites PASS on the 0.2.0-rc.2 host |
| Registry E2E | staged 0.2.1 boots and injects on 0.2.0-rc.2, zero modifications |
| CI | 10/10 required checks including `host-floor` |
| Publish + ops | `latest` -> 0.2.1 on all five; profile refreshed; live scan smoke correct |

## Risks

- **0.2.0 final lands mid-arc**: the window statement is docs-only;
  re-tagging the ceiling after a smoke run is cheap. Plan for it
  rather than blocking on it.
- **E2E protocol still drifting within the rc line**: the adapted
  scripts are gated behind the suite run; a drift surfaces there, not
  in production.
- **Unreviewed in-flight scripts**: the three dirty adaptations predate
  this plan; WS-HS2 reviews them before adoption rather than assuming
  they pass.
- **Long-tail fields** (`agent.session.header.cwd`, `SkillSummary`
  sub-fields): covered by typecheck against real 0.2.0-rc.2 types and
  the E2E pass; both are read-paths with fallbacks.

## Non-goals

- No behavior change to injection, validation feedback, native tools,
  the Skill, or the bridge protocol (`bridgeApi` /
  `promptContextApi` strings unchanged).
- No floor raise; rc.6 hosts stay supported.
- No enforcement reopening (D006), no `additionalContexts` adoption,
  no custom session events (D003), no LLM-protocol handling in the
  adapter.
