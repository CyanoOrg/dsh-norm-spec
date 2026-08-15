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
