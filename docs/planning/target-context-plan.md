# Target-Context Plan: Tracking Defect, Injection Timing, Multi-Directory Scoping

Planning input from the post-0.1.0 runtime review (2026-09-03, extended the
same day by the injection-timing strategy discussion). It records verified
findings about how convention injection actually behaves in real agent
sessions, the approved direction for each, and the workstreams that follow.
Decision records are written at workstream start, before implementation,
per the repository update order.

## Findings

### F1 — Active-target tracking is inoperative (defect)

- DSH rc.6 file tools take `file_path` as their raw tool-argument field
  (`@deepseek-ai/dsh-tool-fs`: `parseReadArgs`, `parseWriteArgs`,
  `parseEditArgs`).
- `updateActiveTarget` (`src/index.ts`) reads only `record.path`, which is
  therefore always `undefined` for `read`/`edit`/`write`. The session target
  never leaves its initial value (`"."`).
- The step-level E2E (`scripts/dsh-e2e-slot.mjs`) drives its replacement
  through a root `.norm` content change and never asserts target re-scoping;
  `updateActiveTarget` has no unit test. The defect therefore passed the
  regression suite and the 0.1.0 gates.

Consequence: directory-scoped convention paging — the README's core
positioning — never engages. Every session injects only the session-root
`.norm` chain. Affected release: 0.1.0.

### F2 — Injection timing boundary (host seam structure)

- DSH rc.6 `PreToolDecision` is `allow | deny | ask`: no context attachment
  and no input rewriting. No plugin seam can deliver a directory's
  conventions before the model's first action that touches that directory.
- The earliest faithful reflection of a new target is the next step's
  `agent/pre-step`, which is what the adapter does. The precise loss is one
  uninformed action — the first touch — and only its *delta*: the inherited
  root chain is always in context; what lags is the touched directory's own
  declarations. The risk concentrates on write-first touches; a read-first
  touch costs nothing because every later action is informed.
- Existing mitigation layers: pre-step paging (covers every decision after
  the first touch), model-initiated `norm_collect` through the Skill
  (norm-spec's documented interaction model: collect before working in a
  directory), and post-edit strict validation as the write/edit backstop.

This is a host boundary, not an adapter or upstream defect. It cannot be
fixed in either norm-spec repository; it is addressed by shrinking the
prediction problem (see F4 and the strategy resolution below).

### F3 — Single-target scoping and digest churn

- Upstream `collect` accepts one target per call; targets are normalized to
  contained-relative paths; a file target collects from its parent directory
  (norm-spec `norm-core/src/collector.rs`), i.e. a file target and its parent
  directory yield the identical chain.
- The prompt projection embeds the target string, so reading file A and
  editing file B in the same directory produces two replacements whose
  convention content is identical (each replacement rewrites the reminder
  slot and breaks the KV prefix at that position).
- Sessions alternating across directories produce flapping replacements.
- `collect` returns ordered per-file entries and no cross-chain merge; how a
  consumer composes multiple chains is currently consumer-defined.

### F4 — The convention layout is statically enumerable

The set of directories that declare `.norm` conventions is a static property
of the project, not a prediction about model output. Upstream ships exactly
this capability: `norm scan` (`norm-spec/scan/v1`) traverses the project and
reports per-directory `has_norm` (verified locally). Prediction of model
output is therefore not required to tell the model, in advance, where
deeper conventions exist.

### F5 — `norm_scan` native tool does not scan (defect)

- The bridge protocol has no `scan` method (dispatch: `status`, `collect`,
  `promptContext`, `validate`, `cancel`, `shutdown`).
- The `norm_scan` tool substitutes `collect` with `target = root`
  (`src/native-tools.ts`), which returns only the root inheritance chain.
- Its declared contract — and the Skill text — promise project-wide
  coverage ("report which directories declare conventions"). In any project
  with subdirectory `.norm` files the tool returns misleading results.

## Approved direction

- **D-A (tracking fix + directory normalization).** Fix the argument field
  and normalize every tracked target to a directory. File targets and their
  parent directories are equivalent upstream, so normalization is
  information-preserving and removes same-directory digest churn.
- **D-B (multi-target context, dual track).** The adapter ships a bounded
  multi-scope reminder now, fanning out over the existing `collect` v1; the
  merge stays projection-level. Cross-chain merge semantics move upstream
  when norm-spec ships batch collect, with a deliberate compatibility-pin
  bump at that time.
- **D-C (timing boundary accepted; prediction delegated to the model).**
  The first-touch gap cannot be closed by host-side prediction. The adapter
  closes it educationally instead: a layout index tells the model where
  deeper conventions exist before it moves, and the Skill tells it to
  collect before working in an unfamiliar directory. Residual risk is
  measured (plugin logs only, per D003) before any stronger mechanism is
  considered.
- **D-D (layout index in a system-prompt section).** The index is injected
  through the rc.6 `dsh-system-prompt` section registry (verified: a Cordis
  `Service` with ordered, uniquely named sections). The system prompt is the
  most stable prefix — the index never churns the KV cache, unlike the
  replaceable reminder slot. If registry integration fails verification at
  implementation time, the fallback is a stable head section of the existing
  reminder.

## Timing-lag strategy resolution (2026-09-03 discussion)

Model output cannot be predicted, but it is conditioned on context the
adapter controls, and the model itself is the only predictor with access to
its own intent. The approved mix:

- **Chosen — enumerate the static layout and educate the decision maker**
  (WS1.5 scan repair + WS5 index + WS4 Skill text). Turns the first touch
  from an unknown unknown into a known unknown: the model knows D declares
  conventions and a one-line summary of what, before it moves.
- **Chosen as optional supplement — cheap host-side prefetch.** Path-like
  strings from recent user messages feed the WS2 bounded target set.
  False positives cost one collect spawn. Prefetch only; never changes the
  injection mechanism.
- **Recorded as viable but rejected — deny-until-informed.** rc.6
  `PreToolDecision.deny` would fully close the first-touch gap: deny the
  call until the directory's conventions are in context, let the refreshed
  reminder land in the same next input, and the model retries informed. It
  is rejected because it converts information paging into blocking retries —
  against the soft-feedback positioning (D006's spirit) — and adds failure
  noise per new directory. Reopen conditions: the D-C measurement shows
  write-first touches into delta-declaring directories cause real harm at
  meaningful frequency, and the mechanism returns as an explicit opt-in
  strict mode with its own decision record.
- **Rejected as redundant — post-execute scope notices.**
  `PostToolDecision.additionalContexts` and the next step's pre-step
  injection land in the same next model input; the pre-step reminder fully
  covers the information. The only divergent case is pre-step failure,
  which is the failure-visibility concern, not timing.

## Workstreams

### WS1 — Tracking fix (first; blocking for everything else)

1. `updateActiveTarget` reads `file_path` (keep a `path` fallback only as a
   harmless alias) and normalizes `read`/`edit`/`write` to the parent
   directory.
2. Extract the projection into a testable unit; add unit tests: field-name
   coverage, success-only updates, write→directory, unknown tools ignored.
3. Extend the E2E suite with a re-scoping assertion: read a file under a
   subdirectory that carries its own `.norm`, then assert the reminder's
   target, `conventionPaths`, and body reflect the subdirectory chain.
4. Ship as a patch release with a CHANGELOG entry; record the defect and the
   normalization decision in `docs/decisions.md` before the fix lands.

### WS1.5 — Bridge `scan` method and a real `norm_scan` tool

1. Bridge: add a `scan` method invoking the pinned upstream
   `norm scan --root .` (upstream capability already exists; no norm-spec
   change), returning `norm-spec/scan/v1`; bounded-output, empty-stderr, and
   cancellation handling identical to collect.
2. Protocol: update `docs/BRIDGE-PROTOCOL.md` method table; the new method
   is additive to `dsh-norm-spec/bridge/v1` and recorded in the decision
   record.
3. TypeScript: `norm_scan` calls the real scan and renders the coverage
   report; keep the `conventionPaths` output key for compatibility with the
   Skill contract.
4. Tests: bridge round-trip against the fake bridge; tool-level test
   asserting subdirectory declarations appear.

### WS4 — Timing boundary, Skill guidance, and measurement

1. Decision record for D-C/D-D: accepted boundary, education strategy,
   rejected deny-until-informed with reopen conditions, measurement plan.
2. Skill text: add explicit guidance to run `norm_collect` before working in
   an unfamiliar directory; consistent with norm-spec's collect-before-work
   interaction model and reinforced by the WS5 index.
3. Measurement (plugin logs only, never the session log): first touch per
   directory classified as read-first vs write-first, whether the directory
   declared its own `.norm`, and — after WS5 — whether the model ran
   `norm_collect` before the first touch. Evidence gates any future strict
   mode.
4. `docs/planning/status.md` carries a standing watch item: DSH rc.7+
   pre-execute context seam; revisit D-C if it ships.

### WS5 — Layout index in a system-prompt section

1. Register one section through the `dsh-system-prompt` registry: unique
   plugin-owned name, fixed order; content is the convention map — every
   directory whose scan reports `has_norm`, one line each from
   `metadata.description`, plus the collect-before-work instruction.
2. Rebuilt only when the layout changes (scan digest), which in practice is
   almost never within a session; bounded size with the established
   fail-not-truncate posture.
3. Decision record must cover: the service-inject change, the exact section
   name and order, assembly-failure behavior (visible, never silent), and an
   explicit amendment of the DSH-specific rule "model-visible output uses
   standard user messages and tool results only" — a registered host section
   is a first-class host surface, not a session event, but the rule as
   written must be updated, not ignored.
4. Fallback if registry integration fails source verification: stable head
   section of the existing reminder (never replaced by scope churn).
5. Depends on WS1.5; pairs with WS4's Skill text.

### WS2 — Bounded multi-target context (adapter-side)

1. TypeScript: session state holds a bounded recent-directory set (LRU,
   maximum 4) instead of one string; collection covers the set each step.
2. Bridge protocol: `promptContext` gains multi-target input. Exact shape —
   optional `targets` array validated strictly against `bridge/v1`, or a new
   method — is recorded in the decision record at implementation time. The
   bridge fans out serially over `collect` v1 under the existing
   one-active-operation rule; cancellation spans the whole fan-out.
3. Engine: deterministic merged projection — one section per scope,
   conventions deduplicated across scopes with scope attribution,
   most-specific-first within each section, one shared 256 KiB budget with
   fail-not-truncate. The merge is projection work only (union, dedupe,
   labeling); no inheritance semantics are invented here.
4. TypeScript rendering: one `<system-reminder>` with per-scope sections;
   single-slot replacement and digest mechanics unchanged; digest computed
   over the rendered multi-scope reminder.
5. Optional supplement: path-like strings from recent user messages feed
   the target set (prefetch only).
6. Prompt-context payload shape may need a version identifier of its own;
   decided in the same record as (2).

### WS3 — Upstream batch collect (norm-spec)

Proposal filed as `docs/planning/batch-collect-proposal.md` in the norm-spec
repository. Once upstream defines batch collect and its merge semantics:
migrate the WS2 merge upstream, consume it as one process call per step, and
bump the `productCompat` pin deliberately. Until then WS2 stands on its own
without upstream changes.

## Sequencing

WS1 → WS1.5 → WS5 (+ WS4 records and Skill text) → WS2 → WS3 adoption.
WS1 is a correctness fix and lands first. WS1.5 unblocks WS5 and repairs an
independent tool contract. WS4's decision record and Skill text ride with
WS5. WS2 depends on WS1's normalized directory targets. Every workstream
runs the full Rust + TypeScript + applicable E2E gates and writes its
decision record before implementation.

## Non-goals

- No blocking enforcement (D006); no `tools/pre-execute` registration — the
  deny-until-informed mechanism stays rejected per the strategy resolution
  with recorded reopen conditions.
- No path guessing from shell commands or custom tools (unchanged rule).
- No convention composition in TypeScript (thin-TS rule).
- No custom session event types (D003).
- No invented cross-chain inheritance semantics pending upstream batch
  collect (WS3).
- No speculation about model output anywhere in the pipeline; the only
  prediction surface is the model itself, served by the layout index.
