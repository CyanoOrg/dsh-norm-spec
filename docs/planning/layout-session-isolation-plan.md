# Layout Session Isolation Plan: D018 + D019 (0.2.2)

Planning record for the 0.2.2 arc, promoted from the review artifact
after a three-round adversarial review (PASS; reviewer and refiner
subagents plus integration rounds; dispositions recorded in sections
11/12). D018 and D019 decision records precede implementation per the
repository update order; the decision texts in section 7 landed in
docs/decisions.md essentially verbatim. v2 keeps v1's structure and
upgrades every section to implementable precision: each "verified" fact
below was re-checked against source on both host lines during this pass
(provenance in §3); v1's five open questions are answered in §4.1 and §10.

HEAD at drafting: `0f663f6` (src/ identical to `9dac5ca` for every cited
line — the intervening commit is docs-only).

## 1. Incident (verified live)

DSH Web (one long-lived host, dsh 0.2.0-rc.2) runs multiple sessions with
DIFFERENT workspaces. Every session's system prompt carries the SAME
`DSH_NORM_LAYOUT_INDEX_V1` block — the map of whichever session refreshed
the layout index last ("last writer wins, then frozen"). Observed twice:

- Reported: session workspace …/AI/dsh-cyano-pipeline (4 .norm dirs) was
  fed …/AI/cyano-pipeline's 12-directory map (6 of those directories do
  not exist in the session repo; root description verbatim from the
  sibling's root .norm).
- Live specimen (verifier session): workspace
  /Users/jiangweide/Tuatara/RustPrjs/dsh-norm-spec, system-prompt layout
  index lists exactly /Users/jiangweide/AI/cyano-pipeline's 12 .norm
  directories (verified by find, verbatim match), while the SAME session's
  per-directory convention reminder (DSH_NORM_SPEC_CONTEXT_MULTI_V1) is
  correctly scoped to dsh-norm-spec. Tools face (norm_scan/collect/
  validate) correctly scoped in both cases.

Secondary observations from the same incident report:

- No layout refresh after .norm edits (edits were made through tool calls
  NESTED inside a program-runner tool; host only surfaces top-level tool
  events to plugins).
- No D013 reminder / no post-edit validation for the same reason.
- Six `dsh-norm-bridge serve` processes under one host (started
  10:08–11:41, all PPID = the live host): per-session bridges never
  reclaimed while sessions stay open in the Web sidebar.

## 2. Root cause (code, src/index.ts @ 0f663f6)

```
102  // Plugin-level layout-index state (D015): one global section reflecting the
103  // most recently refreshed project layout; providers re-read it each assembly.
104  let layoutSectionText = "";
105  let layoutEntryPaths = new Set<string>();
...
249    if (!state.layoutIndexStale && state.layoutIndexDigest !== undefined) return;
...
258      layoutSectionText = index.prompt ?? "";
259      layoutEntryPaths = new Set(index.entries.map((entry) => entry.path));
...
464  ctx.systemPrompt.section({
465    name: LAYOUT_SECTION_NAME,
466    order: LAYOUT_SECTION_ORDER,
467    text: () => layoutSectionText,
468  });
...
477    const declaresNorm = layoutEntryPaths.has(relativeTarget);
```

- apply()-scope singletons; `ctx.systemPrompt.section({ text: () =>
  layoutSectionText })` (line 467) serves ONE map to every session in the
  host. Grep-verified: lines 258/259 are the only writes, 467 (provider)
  and 477 (logFirstTouch) the only reads — no other reader exists in the
  repository.
- Per-session guard at refresh (line 249): `if (!state.layoutIndexStale
  && state.layoutIndexDigest !== undefined) return;` — after each
  session's first refresh it never recomputes, so the last writer's map
  freezes globally.
- `layoutEntryPaths` read by logFirstTouch (line 477) — same
  cross-session contamination in the D015 first-touch measurement.
- Root resolution is NOT the bug: `agent.session.header.cwd` is
  per-session and correct (proven by the correctly-scoped reminder face
  and tools face in the same sessions). Upstream norm-spec is not involved
  (engine renders whatever root it is given; both other faces are
  correct).

Bridge accumulation: one bridge per session (by design, D013/D007), keyed
WeakMap<session, state> (line 100); stopBridge runs on agent/disposed
(line 410-412), which fires only when an agent leaves the registry — Web
sidebar sessions stay resident, so bridges accumulate for the host's
lifetime. 6 live observed.

Nested-tool blindness (not a defect in this repo): in run_code-style
harnesses the file tools are sub-tools; the host emits tool events only
for top-level calls (verified: dsh-tools dispatches `tools/result` /
`tools/post-execute` for the top-level execution object only), so D013
tracking, the .norm-edit refresh trigger, and D006 post-edit validation
cannot fire. Skill text does not document this boundary nor the manual
fallback.

## 3. Verified API facts (both host lines; check don't trust)

Provenance key: [rc2] = installed node_modules @deepseek-ai/* 0.2.0-rc.2;
[rc6] = npm packs @deepseek-ai/dsh-agent / dsh-tools / dsh-system-prompt /
dsh-agent-loop 0.1.0-rc.6 (downloaded across review passes, /tmp/rc6-agent,
/tmp/rc6-tools, /tmp/rc6-sysprompt, /tmp/rc6-loop — the same versions the
CI host-floor job installs; the loop pack provides DIRECT rc.6 loop
evidence, closing round-1's rc.7-inference gap);
[up] = upstream source clone /Users/jiangweide/Tuatara/Research/deepseek-harness
(tags dsh-v0.1.0-rc.7 … dsh-v0.2.1-alpha.2; the clone has no rc.6 tag).

Scope mechanics:

1. `ScopeKey = object` — opaque, identity-compared. [rc2]
   dsh-scope lib/types/index.d.ts:11.
2. `AssembleContext = { scope?: ScopeKey; signal?: AbortSignal }` —
   "When absent, only global providers and subject-less listeners
   participate". IDENTICAL on both lines. [rc2] dsh-system-prompt
   lib/types/index.d.ts:37-45; [rc6] pack lib/types/index.d.ts:37-45.
3. **The assembly scope IS the agent object, by identity, on both
   lines**: `assembleContextFor(agent, signal)` returns
   `{ agent, scope: agent, … }`. [rc2] dsh-agent
   lib/types/dispatch.js:92-94 (mirror lib/index.js:291-297); [rc6] pack
   lib/index.js:384-387.
4. The agent loop assembles with the live agent instance:
   `preStep` calls `this.loopCtx.systemPrompt.assemble(assembleContextFor(this,
   signal))`. [rc2 tag] agent.ts 272 (assemble) / 276-282 (waterfall);
   [up rc.7 tag] 230 / 235; [rc6] dsh-agent-loop pack lib/index.js ~497 —
   the same order on all three lines (line numbers corrected per review
   round 2, finding 4).
5. **Ordering: assembly for step N happens BEFORE the agent/pre-step
   waterfall of step N.** [rc6] loop pack: assemble ~497, waterfall
   ~500-505; [rc2 tag] agent.ts 272 / 276-282. A refresh issued at
   pre-step N is therefore visible from assembly N+1. This is the
   pre-existing D015 timing — already observed live on rc.6 ("the
   convention map appears in the system prompt from the step after the
   first fetch", docs/planning/status.md WS5 note). D018 does not
   change it.
6. Section text providers are evaluated with the full assembly context on
   both lines: `text: typeof section.text === "function" ?
   section.text(context) : section.text`. [rc2] dsh-system-prompt
   lib/index.js:342; [rc6] pack lib/index.js:271.
7. Globally registered sections participate in EVERY scoped assembly:
   `assemble` merges the global layer plus the scope chain
   (`this.layers.merge(scope, …)`); our section is registered through the
   plugin's unscoped context → global layer. [rc2] lib/index.js:310-318;
   [rc6] pack lib/index.js:240-248.
8. `PromptSection.text: string | ((context: AssembleContext) =>
   string)` on both lines. [rc2] types index.d.ts:60; [rc6] :61.

Event→scope identity:

9. `agent/created` is emitted serially with `{ agent: entry.agent, source
   }` through carrier `scopeTarget(agent, agent)` — the payload agent is
   the same object later used as assembly scope. [rc2] dsh-agent
   lib/index.js:513 (carrier), 579-583 (emit); sources: startup, creation,
   resume, clear, compaction (announce doc, lib/index.js:562-588; also
   recorded in our src/host-compat.ts:126-133).
10. rc.6 line: the loop emits `agent/session-start` with the agent after
    `agent/created`: [rc6] dsh-agent-loop pack lib/index.js:1161-1165 —
    publish order sessions.announce → agents.announce → emitAgentEvent
    session-start (direct evidence, upgraded from the rc.7 inference in
    round 1). The separately published rc.6 dsh-agent registry pack emits
    only agent/created; session-start belongs to the loop (published
    standalone and bundled in the rc.6 CLI) — consistent with our
    host-compat legacy branch.
11. Tools events are scoped by the agent: `scopeTarget(this, exec.agent)`
    for tools/result and tools/post-execute. [rc2] dsh-tools
    lib/index.js:3224/3330/3416/3504; [rc6] pack lib/index.js identical
    (3097/3194/3273/3360).
12. The plugin's own listeners are registered on its unscoped plugin
    context, and untagged listeners receive every scoped dispatch
    (dsh-scope scopeTarget contract) — this is how the plugin already
    receives pre-step today; no new registration shape is needed for the
    provider path.

Empty rendering:

13. **Empty section text contributes NOTHING**: `renderPrompt` maps
    sections then `.filter((text) => text.length > 0).join("\n\n")`.
    [rc2] dsh-system-prompt lib/index.js:113-115; [rc6] pack
    lib/index.js:~66-68. Verified in implementation, not just docs: no
    empty marker block, no blank artifact; a section whose provider
    returns "" is dropped from the rendered system prompt.
14. The provider is called inline with NO error guard in `assemble` — a
    throwing provider fails the whole assembly. Our provider therefore
    must be total; `WeakMap.get` + optional chaining is.

Section placement: order 150 (unchanged). The band label drifted
across host lines: the rc.6 PromptSection docs label 100–199 as tool
guidance, while rc.2 places TOOL_* sections at 1000+ and uses 100–199
for context orders — on both lines our 150 renders after the persona and
before tool docs, which is the position D015 chose; informational only,
no behavior change (review round 1, finding 7). Registry fact (unchanged): "Scoped section shadows
a global section with the same name" — scoped registration exists as an
alternative design (rejected, §4.1-D).

E2E/host facts:

15. `dsh --profile headless` = exactly ONE session per process ("Answer
    one task and exit"; flags: --json, --session-id; verified `dsh
    --profile headless --help` on the installed 0.2.0-rc.2 CLI). The
    existing E2E scripts spawn one dsh per scenario (e.g.
    scripts/dsh-e2e-slot.mjs:146-158) — each process loads its own plugin
    instance with its own layout globals, which is why the cross-session
    bug was structurally unreachable there.
16. The multi-session host is `dsh web` (upstream packages/web; upstream
    itself drives it with Playwright e2e). Scripting it from this repo's
    harness would add a browser/e2e dependency class — deferred (§10).

## 4. Proposed design

### 4.1 D018 — per-session layout index (fixes the misbinding)

**Conclusion from verification (v1 open question 1 answered).** For an
agent-driven assembly, `context.scope` is the agent object itself —
identical by `===` to the object delivered in `agent/created` /
`agent/session-start`, `agent/pre-step` payload `.agent`, and
`exec.agent` on tools events — on BOTH host lines (facts 3, 9-11). The
provider can therefore resolve `context.scope` directly to the session
state that `stateFor` recorded for that same agent.

**Design A (provider-selects; chosen).** Data structures (src/index.ts):

```ts
/** This session's own layout snapshot (D018). */
interface LayoutSnapshot {
  /** Engine-rendered prompt; "" until the first refresh lands. */
  text: string;
  /** Root-relative declaring dirs, for the D015 first-touch measurement. */
  entryPaths: Set<string>;
}

interface SessionState {
  // … existing fields unchanged …
  /** Current agent object for this session — the assembly scope key. */
  scopeAgent: object | undefined;
  /** This session's layout snapshot; undefined until first refresh. */
  layout: LayoutSnapshot | undefined;
}

// plugin-level (apply() scope), REPLACING layoutSectionText/layoutEntryPaths:
const stateByScopeAgent = new WeakMap<object, SessionState>();
```

Update points — ONE choke point plus one provider:

1. `stateFor(agent)` (src/index.ts:113-134) is the single write point; it
   is already called on every agent-bearing path (session-start/created
   via startBridge, agent/disposed via stopBridge, agent/pre-step via
   injectContext, tools/result, tools/post-execute via validateAfterTool,
   resolveToolClient). New logic:

   ```ts
   const stateFor = (agent: Agent): SessionState => {
     let state = sessions.get(agent.session);
     if (state === undefined) {
       state = { /* …today's initializer…, scopeAgent: agent, layout: undefined */ };
       sessions.set(agent.session, state);
     } else if (state.scopeAgent !== agent) {
       // Same session object, fresh agent object (resume/clear/compaction
       // on a resident session): re-key the provider index and force one
       // re-fetch so the fresh agent's scope gets a fresh snapshot.
       state.scopeAgent = agent;
       state.layoutIndexStale = true;
     }
     stateByScopeAgent.set(agent, state);
     return state;
   };
   ```

   Note the snapshot lives ON the state, so even if the forced re-fetch
   returns an identical digest (early-return keeps the old snapshot), the
   provider still serves the SAME session's correct map through the new
   agent key — same session ⇒ same root ⇒ same map. The stale mark only
   buys freshness on agent churn at the cost of one layoutIndex request
   per fresh agent.

2. Provider (src/index.ts:464-468) becomes scope-selecting and total:

   ```ts
   ctx.systemPrompt.section({
     name: LAYOUT_SECTION_NAME,
     order: LAYOUT_SECTION_ORDER,
     text: (context) => {
       const scope = context.scope; // AssembleContext, both lines (fact 2/8)
       if (scope === undefined) return "";      // agent-less assembly
       return stateByScopeAgent.get(scope)?.layout?.text ?? "";
     },
   });
   ```

   `import type { AssembleContext }` from `@deepseek-ai/dsh-system-prompt`
   (devDependency type-only import, erased at runtime — same pattern as
   today's line 16 `import type { }`).

3. `refreshLayoutIndex` (src/index.ts:242-264) writes per-session state
   instead of the globals (lines 258-259 become):

   ```ts
   state.layout = {
     text: index.prompt ?? "",
     entryPaths: new Set(index.entries.map((entry) => entry.path)),
   };
   ```

   The per-session digest guard (line 249) is kept unchanged — now
   harmless AND correct (it only skips work for that session).

4. `logFirstTouch` (src/index.ts:470-481) reads
   `state.layout?.entryPaths.has(relativeTarget) ?? false` — per-session,
   fixing the D015 measurement contamination for free.

**Undefined/unknown scope (v1 open question 2 answered).** Agent-less
assemblies (Code Mode, bare `assemble()` in tests/diagnostics) and scopes
the plugin never saw (another plugin's agents, pre-refresh first steps)
all yield `""`, which `renderPrompt` DROPS entirely (fact 13) — no empty
marker block, no artifact. This is the correct semantics: an agent-less
surface must not see any session's map. It is also a strict improvement
over today, where such assemblies see whichever session wrote last.
Verification method: (a) source-level — fact 13 citations; (b) the
dual-scope integration test asserts `assemble()` (no scope) renders no
`DSH_NORM_LAYOUT_INDEX_V1` marker (§4.4); (c) the existing cold-start
behavior is unchanged ("contributes nothing until the first map lands",
src/index.ts:461-463 comment — now per-session).

**Resume/compaction (v1 open question 3 answered).** Both lines announce
a FRESH agent object per creation/resume/clear/compaction (fact 9; our
host-compat.ts:126-133 documents the cross-line superset). Correct
handling falls out of the choke point:

- New session object → new SessionState (digest undefined → refresh runs
  on first pre-step → snapshot written; provider finds it via the new
  agent key).
- Resident session object + fresh agent → `stateFor` re-keys
  `stateByScopeAgent`, marks the digest stale (one re-fetch), keeps the
  snapshot on the state so the provider never serves a gap.
- Dead agent objects → their WeakMap entries become unreachable garbage
  once the host drops the agent (registry removal); no explicit cleanup,
  no leak. The session-keyed `sessions` WeakMap and SessionState
  lifetime are exactly as today.

**Design B (scoped registration) — rejected, with verified grounds.** It
would register a same-named section inside each agent's scope (shadowing
the global via the registry's scoped-shadow rule, fact in §3), which
requires minting a scope (`createScope(ctx, key)`) per agent, re-
registering on every agent churn (resume/clear/compaction), and owning
disposal ordering against the host's registry teardown — strictly more
moving parts than one global section whose provider selects by the scope
key the host already passes. No gain: both approaches serve per-session
text; A does it with zero new registration lifecycle. (Also considered
and rejected: keying by `agent.session` in the provider — the provider
never receives the session, only `context.scope`; a session→state lookup
would still need an agent→session map, which is exactly the WeakMap
above.)

**Other readers (v1 open question 4 answered).** Grep-verified: the two
globals are written only at src/index.ts:258-259 and read only at :467
(provider) and :477 (logFirstTouch). Both readers are migrated above; no
other reference exists in the repository.

**Decision-number/amendment (v1 open question 5 answered).** D018 is the
next free number (docs/decisions.md ends at D017). It AMENDS D015's
"registered globally … per-session scoping is deferred until a scoped
provider surface is verified on the rc line" clause — that verification is
now done (facts 2-8, both lines). Full record text in §7.

### 4.2 D019 — bridge idle recycling (fixes the accumulation)

**Mechanism (final).** Per-state idle timer, armed on activity, reaping
only when provably idle; lazy restart through the existing paths.

```ts
interface SessionState {
  // … D018 fields …
  idleTimer: ReturnType<typeof setTimeout> | undefined;
  /** Open native-tool leases holding the bridge (D019). */
  idleLeases: number;
  /** Queued-but-not-settled validation-tail items (D019). */
  idleQueued: number;
}

interface Config {
  launch?: BridgeLaunch;
  /** Idle TTL before a session/ambient bridge reaps itself. 0 disables. */
  bridgeIdleTtlMs?: number;
}

const DEFAULT_BRIDGE_IDLE_TTL_MS = 600_000; // 10 minutes — see rationale

const ttlMs = (state: SessionState): number => … // config ttl; ambient uses the same config value

function noteActivity(state: SessionState): void {
  armIdleTimer(state);               // lastActivity is implicit: timer slides
}
function armIdleTimer(state: SessionState): void {
  if (state.idleTimer !== undefined) clearTimeout(state.idleTimer);
  const ttl = ttlMs(state);
  if (state.disposed || ttl <= 0) { state.idleTimer = undefined; return; }
  state.idleTimer = setTimeout(() => void reapIfIdle(state), ttl);
  state.idleTimer.unref();           // never holds the host process open
}

const busy = (state: SessionState): boolean =>
  state.starting !== undefined || state.idleLeases > 0 || state.idleQueued > 0;

async function reapIfIdle(state: SessionState): Promise<void> {
  state.idleTimer = undefined;
  if (state.disposed || state.client === undefined) return;
  if (busy(state)) { armIdleTimer(state); return; }   // retry after a full TTL
  const client = state.client;
  state.client = undefined;           // detach FIRST: new callers lazily restart
  if (client.getStatus().state !== "failed") {
    await client.shutdown().catch(() => undefined);   // same guard shape as stopBridge
  }
}
```

**Where the timer resets (noteActivity call sites):**

- `startBridgeFor` settle (ready or failed) — one noteActivity per state.
- Every plugin-issued bridge request is wrapped in the SAME lease
  primitive as native tools (idleLeases increment before the request,
  decrement + noteActivity in a finally) — `refreshLayoutIndex` and the
  `promptContextMulti` request inside `injectContext` (src/index.ts:283,
  286-290). Plugin-issued in-flight requests therefore count in busy();
  a single request longer than the TTL can no longer be reaped mid-flight
  (review round 2, finding 1 — bracketing chosen over the documented-
  degradation alternative);
- the validation tail: `validateAfterTool` increments
  `state.idleQueued` when enqueueing (src/index.ts:393) and the tail's
  settled continuation decrements and calls noteActivity — a reap can
  never fire between two FIFO tail items;
- every native-tool lease release (below).

**In-flight protection — native-tool lease.** The one real race in the
current shape is a tool call being reaped between client resolution and
its request (`withClient` resolves, then runs). Close it by widening the
resolver contract in src/native-tools.ts:

```ts
export interface BridgeLease { client: BridgeClient; release: () => void; }
export type ClientResolver = (exec: ToolRunContext) => Promise<BridgeLease>;

async function withClient<T>(resolve, exec, run): Promise<T> {
  const { client, release } = await resolve(exec);
  try {
    if (client.getStatus().state !== "ready") throw new BridgeClientError(/* tool-unavailable */);
    return await run(client);
  } finally { release(); }
}
```

`resolveToolClient` (src/index.ts:437-451) increments
`state.idleLeases` before returning and releases (decrement +
noteActivity) in the lease — covering the tool's entire execution
including its request.
Timing constraints (review round 2, finding 2): the `idleLeases`
increment and the `state.client` read happen in the SAME synchronous
block — no `await` between them; a not-ready or otherwise-throwing
resolver path decrements BEFORE throwing (a stranded lease would pin
busy() forever and silently disable reaping); `release` is idempotent
(decrement only while the count is > 0).

**Validation-tail mutual exclusion.** As above: counted at ENQUEUE, not
at run-start, so the window between FIFO items is also protected. The
`BridgeRequestCancelledError` early-returns inside `run` leave the
counter consistent because the decrement lives in the settled
continuation, not in run.

**dispose/cleanup.**

- `stopBridge` (agent/disposed, src/index.ts:208-217): unchanged
  immediate shutdown, plus `clearTimeout(state.idleTimer)`.
- Ambient effect (src/index.ts:185-197): the existing disposal gains the
  same timer clear. The ambient state arm/reap through the same helpers
  (`ambientState` IS a SessionState) — the ambient bridge gets the
  identical policy, satisfying the "ambient same policy" requirement with
  zero extra machinery.
- `reapIfIdle` clears its own timer slot; after a reap the state stays
  restartable (`disposed` stays false — that flag remains reserved for
  real disposal).

**Lazy-restart interaction (verified against current code).**
`startBridgeFor` already restarts on demand and both use sites await it
(`injectContext` line 277 "pre-step may win the race on fast first
steps"; `resolveToolClient` line 440). After a reap: `state.client ===
undefined` → next pre-step/tool call restarts the bridge. Retained
`lastDigest` / `layoutIndexDigest` / `state.layout` mean NO re-fetch,
NO reminder replacement, NO layout churn — the system prompt prefix is
byte-stable across a reap/restart cycle.
**Post-execute lazy restart (review round 1, finding 1 — required).**
The third bridge consumer has the same gap today: `validateAfterTool`'s
`run()` (src/index.ts:368-377) reads `state.client` and, when the reap has
taken the bridge down mid-tool-call, would append a false
"bridge is not ready" validation failure. Fix: `run()` opens with
`await startBridgeFor(state)` before reading `state.client` — exactly the
`injectContext`:277 precedent — so a reaped bridge is lazily restarted and
the validation runs. The TTL equals the host tool-timeout ceiling
(600,000 ms), so a full-length tool call is precisely the case where the
bridge reaps underneath the call; without this fix D019 would trade a
resource leak for an intermittent false failure on `.norm` edits. The
restart cost is one spawn+handshake behind the tool result; the
validation-tail enqueue counting above already keeps the reap from firing
*between* queued items.


**TTL = 10 minutes. Rationale.** The observed accumulation is multi-hour
sidebar idleness (six bridges over ~1.5h, all alive until host exit). With
TTL T, steady-state bridge count ≈ sessions active within the last T —
the incident's six drop to zero ~T after each session's last action.
Restart cost is one spawn + ready handshake (startup budget 10s; observed
locally far below) hidden behind the next tool call or pre-step, with no
prompt-side churn (above). 5 minutes churns through ordinary think-pauses
and long tool runs; 30 minutes leaves most of a workday's accumulation
intact. 10 minutes matches "recently used" and common IDE idle defaults.
Exposed as `bridgeIdleTtlMs` (0 disables) so tests can shrink it and
operators can tune without a release.

### 4.3 Skill text amendment (exact diff)

skills/dsh-norm-spec/SKILL.md, "Runtime behavior" — two insertions in the
existing voice (the same file loadSkillRegistration registers at runtime,
so the packaged Skill updates with it):

Diff 1 — after the layout-index bullet (current lines 18-20):

```diff
 - A system-prompt layout index maps every directory that declares `.norm`
   conventions (with its `metadata.description`). It refreshes after `.norm`
   edits; editing a convention file updates the map on the next step.
+- The layout map is per session: each session's prompt carries its own
+  workspace's map, and agent-less surfaces (Code Mode) carry none.
 - Conventions are injected as a single durable `<system-reminder>` user
```

Diff 2 — after the post-edit-validation bullet (current lines 33-37),
before the "Post-edit feedback means" bullet:

```diff
 - A successful `write` or `edit` triggers strict whole-project `.norm`
   validation. Findings are appended to that completed tool result as
   bounded soft feedback, serialized first-in-first-out per session.
   Shell commands, custom tools, and failed edits do not trigger this
   path.
+- These automatic paths rely on host-surfaced tool events, which nested
+  harnesses do not produce: when file tools run nested inside a
+  program-runner tool (for example a `run_code`-style sub-tool), the
+  host reports only the top-level call, so target tracking, layout
+  refresh after `.norm` edits, and post-edit validation cannot fire.
+  In such a harness, run `norm_collect` before working in a new
+  directory and `norm_validate` after editing `.norm` files.
 - Post-edit feedback means the mutation already happened. It does not
```

No behavior change; text only. Grep-verified: neither README.md nor
README.zh-CN describes the layout index or its scoping (README.md's only
"per-session" phrase describes convention injection, which is unchanged),
so no same-commit README sync is triggered by this amendment.

### 4.4 E2E extension (final shape)

Feasibility verdict (v1's open question): **the headless bin cannot host
the dual-session scenario** — one process = one session = one plugin
instance (facts 15). The literal "one host, two live sessions" topology
exists only in `dsh web`; automating it from this repo means driving the
web server API (or Playwright, as upstream does) — a new dependency class,
deferred (§10). The chosen 0.2.2 shape:

1. **Primary gate — dual-scope integration test** (new
   `tests/dual-scope.test.ts`, runs in plain `npm test` and the
   host-floor job; no Rust build needed):
   - Fake bridge fixture `tests/fixtures/fake-bridge.mjs` speaking the
     versioned `dsh-norm-spec/bridge/v1` JSONL framing (ready event with
     payload/compatibility records; responses `layoutIndex` →
     root-dependent canned map — root A carries `LAYOUT-A-ROOT`, root B
     `LAYOUT-B-ROOT` — matching src/layout-index.ts's typed view;
     `promptContextMulti` → minimal valid empty payload
     (`prompt: null`, scopes with zero conventions) per
     src/multi-prompt-context.ts; `validate` → minimal clean response
     per src/validation-feedback.ts; `shutdown` → ack + exit; appends
     its PID to a file named by an env var for D019 assertions).
   - One Cordis app (`new Context()`, SystemPrompt + plugin mounted
     once with `config.launch` pointing at the fixture — the
     scripts/cordis-smoke.mjs pattern), TWO real `Session.create`
     sessions with different `header.cwd`, two fake agent objects
     `{ session }` (structural cast to Agent).
   - Drive each agent through `agentEvents(ctx, agent)` (exported by
     @deepseek-ai/dsh-agent on BOTH lines — rc.6 pack export list
     confirms) — `.emit("agent/created", …)` AND
     `.emit("agent/session-start", …)` back to back (the host-compat
     seam subscribes to agent/created on the 0.2.0 line and
     agent/session-start on rc.6 — emitting both makes the
     creation→startBridge path REAL on both the dev line and the
     host-floor line instead of being backstopped by pre-step's lazy
     start; review round 2, finding 5), then
     `.waterfall("agent/pre-step", { messages: [], signal }, () =>
     Promise.resolve({ kind: "enter", messages: [] }))` — the plugin's
     real listeners run, the real BridgeClient talks to the fixture, the
     real refresh writes state.
   - Assertions:
     a. `app.systemPrompt.assemble({ scope: agentA })` → layout section
        text contains `LAYOUT-A-ROOT` and NOT `LAYOUT-B-ROOT`;
     b. symmetrical for agentB;
     c. `assemble()` (no scope) → no `DSH_NORM_LAYOUT_INDEX_V1` marker
        in the rendered prompt (empty-contribution proof, fact 13);
     d. agent churn: emit BOTH creation events with agentA2 (SAME
        session object as A; symmetrical with the drive step above), one
        pre-step, then the scoped assembly serves the same map (re-key
        path);
     e. ordering stays: the very first assembly for a fresh agent
        carries no map (assembly precedes pre-step, fact 5) — asserted
        once, documenting the D015 timing.
   - This is "single instance, two states" at exactly the granularity
     where the bug lives: ONE plugin instance, ONE section provider, two
     scopes. The regression (a plugin-level singleton) fails assertions
     a/b by construction.
2. **Real-host E2E extensions** (existing scripts; each stays
   one-process):
   - `scripts/dsh-e2e-rescope.mjs`: add `hasOwnLayoutMarker` — assert
     the captured chat request body matches `/- .:
     ROOT-ONLY-MARKER/` (engine renders `- {path}: {description}`,
     crates/dsh-norm-engine/src/layout_index.rs:122) — the layout block
     in the system prompt carries THIS project's own root description,
     not another session's.
   - `scripts/dsh-e2e-slot.mjs` / `dsh-e2e-postedit.mjs`: unchanged
     (no layout assertions there; REV markers cover them).
3. **D019 integration test** (`tests/bridge-idle.test.ts`, same
   fixture): short TTL (e.g. 150ms); after a pre-step drive, wait past
   the TTL and assert (i) the fixture process exited (PID file stale /
   process gone), (ii) a subsequent `norm_validate`-style tool call
   succeeds AND (iii) a NEW fixture PID appears (lazy restart); (iv)
   after `agent/disposed`, no fixture process remains (immediate
   shutdown unchanged); (v) with a lease held open (paused fixture
   response), no reap fires (in-flight protection).
4. **Residual risk (documented, not automated in 0.2.2):** no test
   reproduces the literal one-web-host-two-live-sessions topology. The
   release checklist gains a manual step: open two workspaces in
   `dsh web`, run one step in each, inspect both system prompts for
   their own `DSH_NORM_LAYOUT_INDEX_V1` maps (the incident's
   reproduction procedure). Automation candidate for the 0.3.0 Host
   Adapter SDK track (§10).

## 5. Non-goals

- No behavior change to the reminder face (already per-session correct).
- No nested-tool tracking (host boundary; upstream proposal later).
- No layout-index refresh on external/other-session .norm edits (watcher
  out of scope for 0.2.2).
- No host API or bridge protocol changes (`bridgeApi` /
  `promptContextApi` untouched; D017 window rc.6–0.2.0-rc.2 unchanged).
- No change to the one-step layout visibility lag (host assembly order).

## 6. Release shape

0.2.2 patch: D018 + D019 + skill text + dual-scope/idle tests + rescope
E2E extension; no protocol changes; host window unchanged (rc.6 floor
unaffected — every API used is verified present on both lines, §3).

## 7. Decision record drafts (docs/decisions.md style)

### D018 — Per-session layout index resolved through the assembly scope key

**Decision.** The `dsh-norm-spec:layout-index` section becomes
per-session: the plugin keeps a `WeakMap<object, SessionState>` keyed by
the agent object — the identity the host itself uses as the assembly
scope — and the section provider resolves `AssembleContext.scope` through
it, returning that session's own snapshot. An absent or unknown scope
contributes the empty string, which the host's renderer drops: agent-less
assemblies carry no map at all. The plugin-level
`layoutSectionText`/`layoutEntryPaths` singletons are removed; the
snapshot (`text` + `entryPaths`) moves onto SessionState; `stateFor`
re-keys the map and marks the layout digest stale whenever it sees a
different agent for a session, so each fresh agent re-fetches once. The
D015 first-touch measurement reads the session's own `entryPaths`.

**Context.** A verified incident (2026-10-29, dsh web host 0.2.0-rc.2):
every session's system prompt carried the same convention map —
whichever session refreshed last, frozen thereafter by the per-session
digest guard — including directories that do not exist in the affected
session's repository, while the reminder and tools faces stayed correctly
scoped. Root cause: two apply()-scope singletons served one map to all
sessions (`src/index.ts` layout globals; provider `text: () =>
layoutSectionText`). D015 deferred per-session scoping "until a scoped
provider surface is verified on the rc line"; this record is that
verification, on both host lines: `assembleContextFor(agent)` returns
`{ agent, scope: agent }` (dsh-agent 0.2.0-rc.2 dispatch.js:92-94; npm
rc.6 pack index.js:384-387), section providers are evaluated with the
assembly context on both lines (dsh-system-prompt rc2 lib/index.js:342;
rc.6 :271), globally registered sections participate in every scoped
assembly, `renderPrompt` drops empty sections (rc2 :113-115; rc.6 :66-68),
and the same agent object is delivered in `agent/created` /
`agent/session-start`, `agent/pre-step`, and `tools/*` events — so the
scope key the provider receives is the object the plugin already keys
session state by. Resume/clear/compaction announce a fresh agent through
the same creation event; the re-key handles churn, and dead agents'
WeakMap entries are collected with the agent object.

**Rationale.** Keying by the object the host itself uses as the assembly
scope removes the guessing: the provider can only reach the state
`stateFor` recorded for exactly that agent, so cross-session service is
structurally impossible rather than merely guarded against. Undefined
scope yielding empty is the correct agent-less semantics — Code Mode has
no session and must not see any session's map — and a strict improvement
over the last-writer map such assemblies received before. Keeping the
snapshot on SessionState (with the WeakMap as a scope→state index, re-
keyed at the single `stateFor` choke point every agent-bearing path
already calls) means agent churn can never serve a gap: same session ⇒
same root ⇒ same map, with one forced re-fetch per fresh agent buying
freshness at negligible cost. The provider is total (`WeakMap.get` +
optional chaining), satisfying the assembly's no-throw contract. Scoped
same-name registration was considered and rejected: it needs per-agent
scope minting, re-registration on churn, and disposal ordering against
host teardown — strictly more lifecycle for the same per-session text.

**Amends.** D015's global-registration clause ("The section is registered
globally and reflects the most recently refreshed project layout …
per-session scoping is deferred until a scoped provider surface is
verified on the rc line"). Every other D015 mechanism — the bridge
`layoutIndex` method, the digest guard, the `.norm`-edit stale trigger,
the measurement — stands unchanged.

### D019 — Idle-TTL recycling for session and ambient bridges

**Decision.** Every bridge this plugin starts — per-session and the
agent-less ambient fallback — gains idle recycling: activity (bridge
start settle, each plugin-issued request, each native-tool lease, each
queued validation-tail item) arms a per-state `unref()`-ed timer for
`bridgeIdleTtlMs` (default 10 minutes; 0 disables); on fire with nothing
in flight, the client is detached and shut down gracefully with the same
failed-state guard `stopBridge` uses. `agent/disposed` and Cordis
disposal keep their immediate shutdown and now also clear the timer. The
next use restarts lazily through the existing `startBridgeFor` paths;
retained digests and layout snapshots mean a restart re-fetches nothing
and churns no prompt. Native tools acquire a bridge lease (the resolver
contract widens to `{ client, release }`) so no tool call can be reaped
between client resolution and its request.

**Context.** A verified incident (2026-10-29): six `dsh-norm-bridge
serve` children under one dsh web host (started 10:08–11:41, all PPID =
the host). Bridges stop only on `agent/disposed`, and web sidebar
sessions stay resident for the host's lifetime, so per-session bridges
accumulate without bound on long-lived hosts — exactly the dominant
deployment for this adapter. The lazy-restart half already exists:
`injectContext` awaits `startBridgeFor` before every step ("pre-step may
win the race on fast first steps") and `resolveToolClient` awaits it
before every tool call; `BridgeClient.shutdown` is graceful with a 5s
close timeout; node timers need no host API.

**Rationale.** Idle TTL is the only lifecycle signal the plugin owns that
matches the observed accumulation: steady-state bridge count becomes
"sessions active within the last TTL" instead of "sessions ever opened".
Ten minutes reaps the incident's bridges within minutes of their
sessions going quiet while a restart costs one spawn+handshake hidden
behind the next action — five minutes churns through ordinary pauses,
thirty leaves a workday's accumulation mostly standing; the config knob
keeps the number tunable without a release. Reap-detach-then-shutdown
plus the lease and enqueue-time validation counting close the reap races
without touching the bridge protocol, and the unref'd, cleared-everywhere
timer cannot hold the host process open or leak a state past one TTL.
Failure surfaces are unchanged: a bridge down at an unexpected moment is
the existing visible `tool-unavailable` / validation-failure path, never
a silent empty ruleset.
**Documentation edit shipped with D019 (review round 1, finding 4 —
required).** docs/ARCHITECTURE.md Process model (~lines 107-113) currently
says the bridge has "no silent fallback or restart". Revised wording
keeps the failure clause and names the new lifecycle clause explicitly:
after a failed start the plugin never silently retries (unchanged); an
idle bridge (default 10 min without lease, queued validation, or
activity) is recycled and lazily restarted on next use (D019) — idle
recycling is lifecycle management, not failure fallback. The D019
decision text references the revised section.


## 8. CHANGELOG and release notes drafts

### CHANGELOG [Unreleased] (top of CHANGELOG.md, house style)

```markdown
## [Unreleased]

### Fixed

- Layout-index cross-session contamination (D018): on one long-lived host
  running sessions with different workspaces (dsh web), every session's
  system prompt carried the same convention map — whichever session
  refreshed last, frozen thereafter — including directories that do not
  exist in the session's own repository. The section provider now
  resolves the assembly's scope key (the agent object) to that session's
  own snapshot; agent-less assemblies (Code Mode) contribute no map.
  Amends D015's global-section clause; the first-touch measurement also
  reads the session's own map now.
- Bridge accumulation (D019): per-session bridges previously lived for
  the host's lifetime (six observed under one web host). Session and
  ambient bridges now recycle after an idle TTL (default 10 minutes) with
  in-flight protection, and restart lazily on next use with no re-fetch
  or prompt churn.

### Added

- `bridgeIdleTtlMs` plugin config for the idle-recycling TTL (0
  disables).
- Dual-scope integration coverage: one plugin instance serving two
  sessions with different workspaces asserts per-session layout
  isolation, agent-churn re-keying, and undefined-scope silence
  (`tests/dual-scope.test.ts`); idle-reap coverage with a fake bridge
  (`tests/bridge-idle.test.ts`).
```

### 0.2.2 release notes (user-facing essentials)

- Fixed: each session's system-prompt convention map is its own
  workspace's again on multi-session hosts (dsh web); Code Mode no longer
  sees another session's map.
- Fixed: idle bridges shut down after 10 minutes instead of accumulating
  for the host's lifetime; the next tool call or step restarts one
  transparently.
- New: `bridgeIdleTtlMs` config (0 disables recycling).
- No protocol, host-window, or tool-surface changes; drop-in patch.
  Manual release-checklist addition: two-workspace `dsh web` smoke
  (§4.4 item 4).

## 9. Risk register (v2 mechanisms)

| # | Mechanism | Risk | Mitigation |
|---|---|---|---|
| 1 | Scope-keyed provider (D018) | A future host line stops passing the agent as `context.scope` | Provider degrades to "" (silence, never wrong data); host window changes require a decision record (D017) + host-floor compile; assertion (a/b) in tests/dual-scope catches identity drift on the dev line |
| 2 | Provider throw fails assembly | New code path inside `assemble` | Provider is total: `WeakMap.get` + optional chaining only; no other operations (fact 14) |
| 3 | Same-session agent churn (resume/compaction) | Stale scope key serves a gap or stale map | Snapshot lives on SessionState; re-key at the single `stateFor` choke point + one forced re-fetch; same session ⇒ same root ⇒ same map regardless |
| 4 | Session-object identity reuse across workspaces (host recycles session objects) | A resident state could serve a different workspace's session | Not observed (session objects are registry-owned, one agent per session enforced — registry `enter` throws on id mismatch); would surface as wrong map in tests/manual smoke; revisit on the 0.3.0 SDK track |
| 5 | Reap race (D019) | Tool reaped between client resolution and request | Bridge lease holds `idleLeases > 0` for the whole tool execution; `withClient` still rechecks readiness |
| 6 | Validation-tail window | Reap between FIFO tail items loses queued validations | Counted at enqueue, decremented in the settled continuation; reap requires `idleQueued === 0` |
| 7 | Timer leak / state pinned by timer closure | State held past disposal, or timer fires after dispose | Timer cleared in `stopBridge`, ambient effect, and reap; `unref()` so it never holds the process; `disposed` check at fire |
| 8 | Restart cost / availability | Bridge down exactly when needed | Lazy start already awaited at both use sites; failure surfaces are the existing visible paths (never an empty ruleset); digests retained so no churn |
| 9 | Ambient bridge policy | Ambient reaped while a slow agent-less call queued | Same lease/counting machinery on the ambient state; ambient has no reminder/layout state to lose |
| 10 | Fake-bridge fixture drift | Fixture speaks a stale wire shape | Fixture carries `apiVersion` in every frame; `BridgeClient` fails loudly on mismatch (protocol-mismatch/frame-invalid); parsers reused from src/ enforce typed views |
| 11 | Thin-TS / D003 / host-compat-seam conformance | New logic creeps into policy/parsing | All changes are state, plumbing, and text selection in src/; no YAML, no schema walks, no session events; bridge protocol untouched; cross-line differences still behind host-compat (no new line-dependent code — the provider reads a field present on both lines) |
| 12 | E2E residual | No automated literal web dual-session repro | Integration test at plugin-instance granularity + manual release-checklist step; web automation tracked for 0.3.0 |

## 10. OPEN items (not resolved in this pass — do not treat as verified)

1. **Web-host dual-session automation.** Driving `dsh web`'s HTTP surface
   (or Playwright, upstream's own approach) from this repo's harness was
   not scoped; feasibility not verified here beyond the upstream e2e
   suite's existence. Deferred; manual checklist step covers 0.2.2.
2. **Resume on a resident session reusing the session OBJECT** (and thus
   hitting `stopBridge`'s permanent `disposed` flag from the earlier
   agent's disposal) — pre-existing behavior outside D018/D019's scope;
   observed `agent/disposed` only at real teardown in the incident host.
   Record and revisit on the 0.3.0 Host Adapter SDK track.
3. ~~rc.6 loop internals~~ **CLOSED in review round 2**:
   @deepseek-ai/dsh-agent-loop@0.1.0-rc.6 is published on npm
   independently of the CLI; the downloaded pack (/tmp/rc6-loop)
   directly confirms assemble-before-pre-step (~497) and the
   session-start publish order (1161-1165). Facts 4/5/10 upgraded to
   direct [rc6] evidence; nothing on the rc.6 line rests on rc.7
   inference anymore.
4. **Upstream nested-tool event surfacing** (top-level-only tool events)
   is a host boundary this proposal only documents, not fixes; an
   upstream proposal is future work (v1 non-goal, unchanged).


## 11. Review round 1 disposition (v3 integration record)

Reviewer verdict on v1: PASS-WITH-CHANGES (2 major / 4 minor / 4 notes).
Refiner produced v2 independently; v3 = v2 + three patches + this record.
Patch texts are marked "review round 1, finding N — required" in place.

| # | Finding | Sev | Disposition |
|---|---|---|---|
| 1 | validateAfterTool post-reap false failure (TTL == tool-timeout ceiling) | major | **Patched into §4.2** ("Post-execute lazy restart"): run() awaits startBridgeFor before reading state.client |
| 2 | digest guard depends on unwritten session-rebind invariant | major | Covered by §4.1: stateFor is the single re-key point every agent-bearing path already calls; agent change re-keys the WeakMap entry + forces stale — same effect as the reviewer's three-site scopeAgent refresh, one write point instead of three |
| 3 | in-flight detection (hasPendingRequests suggested) | minor | v2 answers with a stronger mechanism: native-tool leases + validation-tail enqueue counting + starting-guard — closes the resolve->request race a pending-request accessor alone leaves open. Reviewer to adjudicate equivalence in round 2 |
| 4 | clause-level supersede wording + ARCHITECTURE no-restart revision | minor | D018 "Amends. D015 global-registration clause" in §7; ARCHITECTURE revision **patched into §7 D019 tail** |
| 5 | one-process-two-sessions E2E infeasible | minor | §4.4: tests/dual-scope.test.ts (one Cordis app, one plugin mount, two real Sessions, agentEvents drive) as automated gate + manual web live-check in release checklist |
| 6 | timer mechanics under-specified | minor | §4.2: handle on state, unref(), cleared in stopBridge/ambient-dispose/activity-reset, reap never sets disposed |
| 7 | "tool guidance band 100-199" inaccurate | note | **Patched into §3**: both-lines statement (rc.6 docs vs rc.2 order split); order 150 unchanged |
| 8 | subagent map contamination also fixed | note | Inherent in the per-scope design; dual-scope test asserts two scopes |
| 9 | logFirstTouch relative-path fragility (pre-existing) | note | Follow-up, out of 0.2.2 scope |
| 10 | ambient bridge root = process.cwd() (pre-existing) | note | Known-limitation sentence in D019 context |
| 11 | design B runtime dsh-scope dependency | note | §4.1-D rejects B on the same grounds |

Round-2 asks: (a) confirm findings 1-6 resolved as mapped; (b) adjudicate
the two intentional deviations from the reviewer's suggested shapes (lease
design vs hasPendingRequests; stateFor re-key vs three-site scopeAgent
refresh) — accept or object with grounds; (c) scan the v2 additions the
round-1 review has not yet seen (leases, enqueue counting, dual-scope
test via exported agentEvents, ordering assertions, decision texts,
skill diff, risk register) for NEW issues.


## 12. Review round 2 disposition (v4 record)

Round-2 verdict: PASS-WITH-CHANGES, 4 text-level items; both intentional
deviations from round 1 ACCEPTED by the reviewer (lease design strictly
stronger than hasPendingRequests; stateFor single-point re-key verified
equivalent and better — no first-request gap on agent churn). All 6
round-1 must-change items independently verified as implemented.

v4 applies the 4 round-2 items, each marked "review round 2, finding N":

| # | Finding | Sev | Disposition in v4 |
|---|---|---|---|
| 1 | busy() misses plugin-issued in-flight requests | minor | §4.2 timer-reset list: refreshLayoutIndex + promptContextMulti wrapped in the SAME lease primitive (bracketing chosen over documented degradation) |
| 2 | lease increment timing unpinned | minor | §4.2 lease section: same-sync-block increment + client read, decrement-before-throw, idempotent release |
| 3 | OPEN 3 closable: dsh-agent-loop@0.1.0-rc.6 published on npm | note | OPEN 3 marked CLOSED; facts 4/5/10 upgraded to direct [rc6] pack evidence; provenance key updated; fact 4 line numbers corrected (rc.2 tag 272/276-282) |
| 4 | dual-scope test emits only agent/created | note | §4.4 drive: emits agent/created AND agent/session-start back to back — creation path truly driven on dev line and host-floor line |
