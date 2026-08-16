# Decision Records

Decision records are append-only. Reversals are new records referencing the
decision they replace.

## D001 — Fork the pi-norm-spec bridge instead of linking or rewriting

**Decision.** dsh-norm-spec forks the Rust `pi-norm-bridge`/`pi-norm-engine`
crates and the TypeScript bridge client from pi-norm-spec at its E2-complete
state (commit `1b820ff`), renaming the protocol namespace to
`dsh-norm-spec/bridge/v1`. It does not link pi-norm-spec crates as a
dependency and does not rewrite the bridge from scratch.

**Context.** The 2026-08-14 strategy discussion deferred a shared Host
Adapter SDK until after the second adapter exists. pi-norm-spec's bridge
carries a verified protocol (status/collect/promptContext/validate/cancel/
shutdown), sealed-payload verification, compatibility handshake, and
one-active-operation semantics; rewriting it would duplicate ~3,300 lines
of already-tested Rust for no semantic gain.

**Rationale.** Fork-now-converge-later matches the agreed SDK timing: the
fork documents exactly what differs between hosts (apiVersion strings,
error-code prefixes, prompt-context API id), which becomes the SDK's
extraction boundary. A crate dependency would couple two independently
released adapters more tightly than their SemVer permits (pi-norm-spec
D005's own argument against linking).

## D002 — Follow the DSH agent-instructions injection idiom, not pi's

**Decision.** Context injection uses DSH's durable model: one user-role
message framed in the plugin-owned `<system-reminder>` pattern, injected at
`agent/pre-step`, with a typed source and SHA-1 content digest suppressing
re-injection of unchanged content. It does not attempt pi's per-turn
deep-copy ephemeral injection.

**Context.** DSH rc.6 has no per-provider-turn context-copy event. The
official `dsh-agent-instructions` plugin establishes durable injection with
digest-based dedup as the platform idiom; it is KV-cache-friendly and
resume-stable.

**Rationale.** Host-native behavior beats cross-host uniformity: the
adapter's job is to project norm-spec semantics into the host's
established pattern, not to force pi semantics onto DSH.

## D003 — Never write custom session event types

**Decision.** The plugin never appends custom event types to the DSH
session log. All model-visible output uses standard user messages and tool
results; diagnostics go to plugin logs only.

**Context.** DSH Discussion #1584 (verified rc.6): `dsh-session` validates
persisted logs against a static event-type list; a plugin-written custom
event makes the whole session log unloadable (no history, no resume).

**Rationale.** Session-log integrity outranks any diagnostic convenience.
This constraint may be revisited only if upstream ships the registration
surface proposed in #1584.

## D004 — Pin DSH at 0.1.0-rc.6 and develop locally; publication waits

**Decision.** Development targets `@deepseek-ai/dsh@0.1.0-rc.6` with
peerDependencies pinned to `^0.1.0-rc.6`. npm publication is deferred
until DSH ships a tagged stable-compatible release or the official plugin
ecosystem demonstrates API stability across consecutive rc versions. The
repository stays local (no GitHub remote) until Wade returns.

**Context.** The 2026-08-14 strategy discussion's D5 said "wait for the
first tagged release". rc.6 is not that, but official plugins are now
published on npm (dsh-fs-local, dsh-app-boot, dsh-credentials-local),
which de-risks the plugin API surface. The 69k-star window favors early
development; publication carries the break-risk.

**Rationale.** Separates development progress (reversible, low cost) from
publication (irreversible, reputation-bound). Local-first matches Wade's
instruction on 2026-08-15.

## D005 — Start an independent product line at 0.1.0-alpha.1

**Decision.** dsh-norm-spec begins its product line at `0.1.0-alpha.1`
with its own Git history. Forked code from pi-norm-spec carries this
repository's identity; pi-norm-spec's history is not imported.

**Context.** Same pattern as pi-norm-spec D004 (independent public history
for an independent product) and the 2026-08-10 two-repository plan.

**Rationale.** The adapter's maturity is described by its own version;
forked behavior is captured as protocol fixtures and tests in this repo.

## D006 — Hard enforcement stays empty

**Decision.** dsh-norm-spec registers no blocking `tools/pre-execute`
guard. Prompt context is guidance; post-edit validation is soft feedback
appended through `tools/post-execute` `PostToolDecision.content`.

**Context.** Mirrors pi-norm-spec D010. DSH's guard API exists, but the
upstream closed typed operation-policy declaration does not.

**Rationale.** Blocking on prose `.norm` declarations would create false
assurance. Reopen requires the same two prerequisites as pi-norm-spec:
an upstream typed policy declaration and a host-side final-input
guarantee.

## D007 — Provide an ambient fallback bridge for agent-less tool calls

**Decision.** Native tools resolve their bridge through the calling agent's
session state when `exec.agent` exists, and through one plugin-level ambient
bridge otherwise. The ambient bridge is created lazily on first agent-less
resolution, disposed through a named Cordis effect, and never replaces
per-agent session bridges.

**Context.** The 2026-08-15 Cordis smoke against the real dsh-tools
ToolRuntime showed tool calls can arrive without an agent (harnesses, Code
Mode sub-dispatch views, direct registry consumers). The first
implementation threw `tool-unavailable` for every such call.

**Rationale.** Tool semantics do not depend on agent session state; the
sealed-payload bridge is stateless across calls. A single ambient child
keeps agent-less calls functional while per-agent bridges preserve D008's
observable session lifecycle for the injection path.

## D008 — Injection stays durable; bounded occupancy via single-slot replacement is the approved direction

**Decision.** Convention injection keeps the durable `agent/pre-step`
semantics confirmed by the 2026-08-15 E2E (D002): injected reminders enter
the session surface once, suppressed thereafter by digest. The pi-norm-spec
ephemeral per-turn injection model ("use and discard, never entering the
next turn's context") is explicitly **not** pursued on DSH rc.6. The
approved follow-up direction is single-slot replacement: keep the
convention reminder to at most one surface message, shadowing the previous
one through a session `surfaceOp` replace when conventions change.

**Context.** Source verification against dsh-agent-loop rc.6 (2026-08-15):

- `agent/pre-step` is the only supported message-injection seam, and the
  loop appends every `decision.messages` entry to the session log as
  `user/message` with `surfaceOp: "append"` — injection is necessarily
  durable.
- The `agent/request` waterfall documents that it "cannot mutate
  messages"; no ephemeral per-request channel exists in the public API.
- The dsh-native precedent for bounded occupancy is
  `RuntimeContextProjection` (runtime-context snapshots): one retained
  message, superseded snapshots replaced on the surface ("This snapshot
  supersedes earlier runtime-context snapshots").
- D007's rationale references "D008" by number in error; it means D002's
  session-scoped injection lifecycle. Recorded here rather than editing an
  immutable decision.

**Rationale.** Ephemeral per-turn injection re-sends the prompt every
request at identical token cost while its position varies per turn,
defeating prefix-stable KV cache reuse. Durable-once with digest
suppression is prefix-stable and cache-friendly; the real cost under
frequent convention changes is unbounded growth, which single-slot
replacement bounds to one message — the practical equivalent of
"discarded after use": bounded occupancy, automatic refresh, prior
versions invisible to the model. Implementation requires verifying a
plugin can produce replace ops (strict `sourceEventSeqs` provenance
checks); if a public helper is needed, raise it upstream before
implementation. Revisit only if the host ships a supported ephemeral
channel (watch rc.7+).

## D009 — One dsh-specific Skill, registered at runtime from the plugin package

**Decision.** dsh-norm-spec exposes one Skill owned by this repository.
The plugin registers it into `ctx.skills` at `apply()` time as a runtime
skill from the package file, following the pi-norm-spec D007 pattern.
The Skill documents dsh-specific behavior (injection lifecycle, single
slot, post-edit feedback, native tools) and links to upstream canonical
documentation for format authoring and validation; it does not copy or
surface the upstream canonical Skill as a second product Skill. The
bundled upstream payload may retain canonical files for provenance, but
they are not registered as dsh resources.

**Context.** Source verification against dsh-skill rc.6 (2026-08-16):

- `ctx.skills.register(registration)` accepts an embedded runtime skill:
  `name`, `description`, `content` (markdown body), plus optional
  `whenToUse`, `invocation`, `provider`. Omitted invocation defaults to
  both-invocable; omitted provider labels it `"runtime"`.
- Runtime skills use rank 250: project roots (`.dsh/skills`,
  `.agents/skills`) override them, and they override the local
  provider's custom and user roots. Rank 600 is reserved for the
  host-controlled bundled root (`DSH_BUNDLED_SKILL_DIR`), which a plugin
  neither controls nor needs.
- The filesystem provider discovers skills as directories named for the
  skill containing a `SKILL.md` with YAML frontmatter (`name`,
  `description` required; `whenToUse`/`invocation` optional). Invalid
  frontmatter is warned and ignored, not a load failure.
- The skill consumer surface: `ctx.skills.list()` feeds the durable
  catalog and the `skill` tool; `ctx.skills.get(name)` loads the body on
  demand; `renderSkillContent` renders the canonical
  `<skill_content>` block for the model. A runtime-registered skill is
  model- and user-invocable by default — no extra registration needed.

**Rationale.** Skill distribution is where multi-framework projects
actually collide, and runtime registration keeps every collision surface
clean:

- The plugin is the single distribution unit: `dsh plugin --profile X
  add dsh-norm-spec` installs automation and skill together; uninstall
  removes both; user project trees stay untouched.
- Cross-framework coexistence is structural: host skills are registered
  in each host's registry and never touch the shared `.norm` data or
  each other. A user-placed canonical skill (rank wins over runtime) and
  a plugin-registered host skill describe different concerns (CLI
  workflow vs host injection behavior) and can coexist by design.
- The bundled root (`DSH_BUNDLED_SKILL_DIR`) and installer-driven file
  copies into user roots are explicitly rejected: the first is
  host-controlled, the second re-creates the exact multi-framework
  residue problem D009 exists to avoid.
- Fidelity to pi-norm-spec D007: same shape (one host skill, upstream
  links, no canonical duplication), mapped onto DSH's runtime
  registration seam.

## D010 — Public GitHub repository with layered main governance

**Decision.** The canonical repository is `CyanoOrg/dsh-norm-spec`, public,
default branch `main`, governed by the layered rulesets replicated from
pi-norm-spec D014: `main-integrity` (no deletion, no non-fast-forward,
linear signed history), `main-quality` (exact strict CI contexts
rust-quality / ts-quality / norm-validate, no bypass), `main-review`
(one approving review, stale-review dismissal, resolved threads; the
`norm-release-managers` team may bypass), and `release-tag-immutable`
(v* tags cannot be updated or deleted, no bypass). Secret scanning,
push protection, and Dependabot security updates are enabled. npm
publication stays deferred per D004; D010 supersedes only the
"local until Wade returns" clause of D004's context.

**Context.** Wade created and pushed the repository on 2026-08-16. The
first CI run (31934962929) passed all three jobs on the exact pushed
head; required-status contexts were configured from that run's job
names. Automation identities (cyano-bot) are not in the release-manager
team; every merge to main therefore goes through pull requests with the
strict checks.

**Rationale.** Same layered-integrity rationale as pi-norm-spec D014:
integrity and quality have no bypass because history and evidence are
non-negotiable; review has a narrow bypass for exact-candidate
fast-forwards by release managers only. Reusing the org teams
(norm-maintainers, norm-release-managers) keeps release authority
uniform across the norm-spec family without sharing required checks.

**Supersedes.** D004's "no GitHub remote until Wade returns" clause;
D004's npm deferral stands unchanged.
