# Host Sync Plan: DSH Compat Window 0.1.0-rc.6 -> 0.1.5-rc.3

Planning input from the 2026-09-25 upstream review of the local
deepseek-harness clone (HEAD `477b4f4205`; tag `dsh-v0.1.5-rc.3`
inspected directly, not via changelog inference) and the same-day
direction discussion. It records verified findings about the drift
between our pinned host (`0.1.0-rc.6`, D004) and the current npm
`latest`, the approved direction, and the workstreams that follow. A
decision record (D017) is written at implementation start, before any
version lift, per the repository update order.

## Findings

### H1 — npm `latest` moved to 0.1.5-rc.3; new users are already there

- `@deepseek-ai/dsh` dist-tags (registry, 2026-09-24):
  `latest = 0.1.5-rc.3`, `next = 0.1.7-rc.2`, `alpha = 0.1.7-alpha.2`.
- A fresh global install today yields a 0.1.5-rc.3 host, while our
  published packages claim `^0.1.0-rc.6` peers.
- Upstream cadence since our pin: 0.1.0-rc.7/rc.8 -> 0.1.1-rc.x ->
  0.1.2/0.1.3 alphas -> 0.1.5 alpha/rc line -> 0.1.6/0.1.7 already at
  `next`. The gap only grows by waiting.

### H2 — The plugin API surface is unchanged across the whole window

Verified against the `dsh-v0.1.5-rc.3` tag for every API we consume:

| Adapter usage (`src/`) | 0.1.5-rc.3 status |
|---|---|
| `agent/session-start`, `agent/disposed` | present, payload unchanged |
| `agent/pre-step` | payload `{agent, messages, signal}` unchanged; additive `turn`/`step` |
| `tools/result` | emit mode, `(exec, result)` unchanged |
| `tools/post-execute` | `(exec, result, next)` unchanged; `PostToolDecision` identical to rc.6 field-for-field |
| services `tools`/`skills`/`systemPrompt` | names, `register()`, `section({name, order, text})` unchanged |
| `SkillRegistration` (D009) | type definition identical to rc.6 |
| cordis `^4.0.1` | satisfied by upstream 4.0.2 |

The rc.6..0.1.5-rc.3 range spans 3971 commits including 8 breaking
internal refactors (session format v2, persistence rewrite, apiproxy
RPC removals) — none touch the plugin surface.

### H3 — De-facto compatibility already exceeds the pin

The local GUI host (0.1.1-rc.2) runs our published 0.2.0 plugin; session
injection and the native norm tools were observed working on it
(2026-09-25 session evidence). The pin documents a floor that reality
has passed; H2 shows nothing in 0.1.5-rc.3 breaks it.

### H4 — `^0.1.0-rc.6` cannot match `0.1.5-rc.3` (prerelease semantics)

Under node-semver, a prerelease version satisfies a range only through a
comparator sharing its `[major, minor, patch]` tuple. `^0.1.0-rc.6`
(`>=0.1.0-rc.6 <0.2.0-0`) therefore matches 0.1.0-rc.7/rc.8 and any
released 0.1.x, but not `0.1.5-rc.3`. An explicit
`>=0.1.0-rc.6 <0.2.0` upper-bounds with a release comparator and
matches every 0.1.x prerelease above the floor — without raising it.

### H5 — Support packages drifted (minor, compatible)

cordis 4.0.1 -> 4.0.2; cordis-plugin-loader 1.0.2 -> 1.0.3 (vendored
upstream). Both semver-compatible; the packaging contract is re-verified
by the staging smoke and registry E2E in WS-HS2/HS3.

### H6 — D004's stability trigger has fired

D004 pinned rc.6 pending "the official plugin ecosystem demonstrating
API stability across consecutive rc versions". Five consecutive rc
lines have shipped with our entire consumed surface unchanged (H2).
Per the update order, D004's pin clause is revised (D017) before the
version lift.

## Approved direction (2026-09-25)

- **HS-A Compat window, not a floor raise.** Supported host window:
  `0.1.0-rc.6` through `0.1.5-rc.3`. The floor stays rc.6; nothing in
  this sync needs newer host behavior. `0.1.7-rc.2` (`next`) is a
  smoke-only forward-look, not a support claim.
- **HS-B Peer range made explicit.** `peerDependencies` in
  `package.json` and `packages/root/package.json` move to
  `>=0.1.0-rc.6 <0.2.0` for the five `@deepseek-ai/dsh-*` peers;
  cordis stays `^4.0.1`.
- **HS-C Dev/CI target line rises to 0.1.5-rc.3.** Lockfile, staging
  runtime, and the primary verification path track npm `latest`; the
  rc.6 floor stays continuously verified (WS-HS4).
- **HS-D Out of scope, separately decided.**
  1. `PostToolDecision.additionalContexts` as the D006 feedback
     channel — 0.3.0 candidate with its own decision record; it exists
     since rc.6, so it is decoupled from this sync.
  2. D-C reopen — `tools/pre-execute` at 0.1.5-rc.3 is still a pure
     allow/deny/ask gate (verified at the tag); timing posture unchanged.
  3. Upstream Discussion #1584 watch (D003) unchanged.

## Workstreams

### WS-HS1 — D017 decision record (before implementation)

Supersedes D004's pin clause only (D010 already superseded the
local-visibility clause): records the window (HS-A), the peer-range
semantics (HS-B), the dev/CI target (HS-C), and the non-goals (HS-D).
May land on the WS-HS2 branch if review prefers one arc; the record
itself still precedes any version change in the commit order.

### WS-HS2 — Mechanical version lift

Branch `chore/host-sync-0.1.5-rc.3`.

- devDependencies: the rc.6 0.1.0-rc.6 pack -> 0.1.5-rc.3 (agent,
  attachment, brand, code-runtime, invariants, llm, scope, session,
  skill, system-prompt, timeout, tools, typert-protocol,
  user-approval); cordis 4.0.2; loader 1.0.3. Commit
  `package-lock.json`.
- Regenerate `.local-runtime/stage` (stale rc.6 references).
- Gates: `cargo fmt --check`; clippy `-D warnings`; `cargo test`;
  `npm run typecheck` (the compile-time proof of H2 against real
  0.1.5-rc.3 types); `npm test`; staging smoke.

### WS-HS3 — E2E against a real 0.1.5-rc.3 host

- Parameterize `scripts/dsh-e2e-rescope.mjs` host root (env
  `DSH_E2E_ROOT`, default `/tmp/dsh-e2e` unchanged) and stand up a
  second host dir with registry-installed `@deepseek-ai/dsh@0.1.5-rc.3`;
  run the full re-scope / single-slot / layout-index assertion path.
- P4-style registry E2E for the staged 0.2.1 packages on the 0.1.5-rc.3
  host (fresh `DSH_HOME`, registry install, no env overrides).
- Forward-look: the same script once against 0.1.7-rc.2; results
  recorded in status.md as smoke evidence only.

### WS-HS4 — CI floor verification

The lockfile moves forward (HS-C), so rc.6 needs its own guard:

- `ci.yml` gains a `host-floor` job: install the rc.6 peer pack over
  the checkout, then `typecheck` + `npm test`. Keeps the floor
  compile- and unit-verified on every push.
- The job joins `main-quality` as a required check (D012 governance
  edit via `norm-automation`; 9 -> 10 required checks).
- Review point: whether 0.1.1-rc.2 warrants a leg or stays covered by
  local evidence (H3) — default: no leg; matrix stays floor + latest.

### WS-HS5 — Docs, `.norm`, and release

- Root `.norm`: hard-constraint line "DSH host surface pinned to
  0.1.0-rc.6 until D004 reopens" -> a window statement citing D017;
  gate `norm validate .norm --strict`.
- `README.md` + `README.zh-CN.md` in the same commit: host
  compatibility statement gains the window.
- `AGENTS.md` (Current state), `docs/ARCHITECTURE.md` (host section;
  strong reference target), `ROADMAP.md` (record under 0.2),
  `docs/planning/status.md`, `CHANGELOG.md` at release.
- Release **0.2.1** in five-package lockstep (D011): peer-range widening
  plus dev-dep lift are patch-level; no runtime behavior change;
  `productCompat =0.1.0-rc.1` untouched (WS3 owns it). Normal arc:
  promotion PR -> 10/10 checks -> ff merge -> signed tag `v0.2.1` ->
  candidates -> human publish without `--tag`.

## Acceptance

| Gate | Evidence |
|---|---|
| Rust | fmt / clippy / test green on the WS-HS2 branch |
| TypeScript | typecheck + `npm test` green against 0.1.5-rc.3 types |
| `.norm` | `norm validate .norm --strict`, 0 errors after WS-HS5 |
| Staging | smoke green on the regenerated stage |
| E2E | rescope E2E PASS on a 0.1.5-rc.3 host; registry E2E green |
| CI | 10/10 required checks including `host-floor` |
| Publish | `latest` -> 0.2.1 on all five packages; post-publish smoke |

## Risks

- **Unverified long-tail fields** (`agent.session.header.cwd`,
  `SkillSummary` sub-fields): mitigated by typecheck against real
  0.1.5-rc.3 types plus the E2E pass; both are read-paths with
  fallbacks in the adapter.
- **Upstream keeps moving** (0.1.7 at `next`): absorbed by the window
  statement and the status.md watch item; the next sync is another
  deliberate bump, not an emergency.
- **CI cost**: one extra install + test job per push; acceptable
  against the existing nine required checks.

## Non-goals

- No behavior change to injection, validation feedback, native tools,
  the Skill, or the bridge protocol (`bridgeApi` / `promptContextApi`
  strings unchanged).
- No floor raise; rc.6 hosts stay supported.
- No enforcement reopening (D006), no `additionalContexts` adoption,
  no custom session events (D003).
