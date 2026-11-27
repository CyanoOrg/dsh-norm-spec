# Convention Reminder Lifecycle Plan

This plan opened on 2026-11-26. The D022 reminder lifecycle fix
shipped in 0.2.5 on 2026-11-27. The release snapshot records the
registry install and provider-request checks.
[Decision records](../decisions.md) · [Release verification](status.md#verification-snapshot-2026-11-27-025)

## Evidence on 0.2.4

The audit used the published 0.2.4 package on DSH 0.2.2-rc.5 with the sealed
norm-spec 0.1.0-rc.1 payload and a local stub provider. The assertions
inspected outgoing model requests and used distinct markers for rule bodies
and layout descriptions. Auxiliary requests were excluded.

| Probe | Observation |
| --- | --- |
| Remove the last active `.norm` between model steps | Canonical collection succeeded with zero conventions. The next provider request still contained the previous rule body. |
| Replace the active `.norm` with invalid input between model steps | Canonical collection returned `norm/parse/not-a1`. The next provider request still contained the previous rule body. |
| First call writes a new file in an unvisited directory | The write succeeded. The directory rule body first appeared in the request after the tool result. |
| Call `norm_collect` on that directory before writing | The collection result delivered the directory rule body in the request that then issued the write. The write succeeded. |
| Shadow the old slot, then return the same rule body | A separate probe used the real session surface and plugin listener with a stub bridge. The old node was off the surface and the next pre-step returned no replacement. Real host compaction and resume still need coverage. |

The injection handler returns before reconciling the existing slot when
collection is empty or unavailable. On nonempty success, the digest check
precedes the slot lookup. The cached layout description also survived
external removal of the rule file in the request probe. Layout freshness
has a separate system-prompt path.
[Injection handler](../../src/index.ts)

## Request behavior

Retain the most-recent-first set of up to four target directories from D016
and the durable single slot from D008. Apply the following behavior at the
next model request that proceeds after collection.
[Decision records](../decisions.md)

| Collection or surface state | Expected request and visible state |
| --- | --- |
| Success with rules | One adapter-owned active rule block reflects the fresh result. When a directory is evicted, its exclusive rules leave the block. Shared ancestors used by remaining scopes are rendered in full once. |
| Success with every scope empty | The old rule body is absent from the request. A fresh empty session needs no reminder. The session log can retain the original event for replay. |
| Bridge unavailable or collection fails | The old rule body is absent from the request. Report the failure as unavailable with its cause, distinct from successful empty collection. A later success restores the current rules. |
| Same digest after compaction or resume | An unchanged visible slot can be reused. When that slot is gone, emit the current rules again. Track the adapter's instruction slot independently of its notices. |

Use a surface operation supported across the D021 host window. Acceptance
checks active rule content in the provider request and inspects the
surface to diagnose placement. Explicit tool results and their history
have their own lifecycle. Confirm layout behavior separately, including
the next request after a supported `.norm` edit and the freshness policy
for external file changes.

## Rule delivery before writes

When the destination is known, explicitly collect for it before the model
decides to write. For a new file, use its existing parent directory. If the
native tool truncates the rule text, use the verified bundled CLI to obtain
the complete chain. Read the referenced material relevant to the change.
The normal auto-follow path starts after a successful supported file tool
observes the target. A read and a write in the same tool batch have no
intervening model request. Shell and custom-tool edits need explicit
collection and validation when the workflow requires them.
[DSH Skill](../../skills/dsh-norm-spec/SKILL.md)

## Request-level acceptance

Use a real host with a local stub provider. The
[lifecycle regression](../../scripts/dsh-e2e-reminder-lifecycle.mjs)
captures the five-step rules, empty, recovery, failure, and recovery
sequence. Assert the request that issues
each edit, the request after each tool result, and the request after each
scope transition. Record the adapter and host versions, the paths or marker
identities observed, and whether the provider request or only the session
surface was tested.

- [x] Compare first direct write, separate read then edit, and explicit
      collect then write. For the direct write, check the rule arrives on
      the request after the tool result. For the latter two, assert the
      intended rule body and scope in the request that issues the write.
- [x] Visit five distinct sibling directories. Assert the retained four
      scopes in recency order, absence of the evicted scope's exclusive
      body, and one full copy of the shared ancestor.
- [x] Exercise successful empty collection, collection error, bridge
      unavailability, and recovery. Assert rule body absence in empty and
      unavailable requests and an observable cause only on failure.
- [x] Exercise real compaction and resume with identical rule content.
      Native compaction shadowed the old slot on both host endpoints.
      On `0.2.2-rc.5`, resuming the saved session in a fresh process
      preserved the restored slot and sent one copy of the rule.
- [x] Exercise shell modification and a successful built-in edit that
      introduces a `.norm` validation finding. Check when explicit
      collection is needed and when the post-edit diagnostic reaches the
      tool result.
- [x] Inspect the layout block separately after a supported `.norm` edit
      and an external file change. Record when the refreshed index
      reaches the provider and when the cached layout is reused.

## Delivery

Record the reviewed lifecycle decision with references to D008, D016, and
D021. Implement session-side reconciliation and add request-level
regression coverage at the supported floor and ceiling (`0.1.0-rc.6` and
`0.2.2-rc.5`). Run the applicable gates and independent review before
promoting a patch.
The upstream collect/v2 work follows its post-stable schedule. This patch
uses the current sealed collect/v1 payload.
[Upstream decision](https://github.com/CyanoOrg/norm-spec/blob/main/docs/decisions.md)

## Local verification and independent review

- The request regression failed on the 0.2.4 implementation because the
  old rule text survived both empty and invalid input. The fixed
  `3a1244e` candidate passed the five provider requests on real DSH
  `0.1.0-rc.6` and `0.2.2-rc.5` with a local stub provider and the
  released rc.1 engine.
- TypeScript typechecks and all 40 tests passed against each host
  endpoint. The focused tests cover a shadowed slot, legacy duplicate
  retirement, post-edit notice preservation, bridge startup failure,
  and cancellation after the bridge received the request. Rust fmt,
  strict Clippy, 19 unit tests, rustdoc, and strict `.norm` validation
  passed locally.
- Independent review found a cancellation race where a late bridge
  result could still replace the slot. The candidate checks the abort
  signal before reconciliation, and the regression verifies that the
  slot stays untouched. The reviewer reran the three focused tests.
- The rc.6 provider adapter can serialize the contentless notice as an
  empty user placeholder. The request regression verifies absence of
  old rule text. The session-surface fixture covers a shadowed slot.

### Native compaction and persisted resume

An isolated headless run invoked the host's compaction service on a
balanced span containing the original reminder. A local stub provider
returned a short checkpoint with a distinct marker. The probe checked
both the shadowed sequence numbers and outgoing provider requests.

- On shipped adapter `0.2.4` and host `0.2.2-rc.5`, the old slot left the
  surface. The next task request carried the checkpoint and zero copies
  of the unchanged rule.
- On candidate `3a1244e`, the next task request carried the checkpoint
  and exactly one copy of the unchanged rule on both `0.1.0-rc.6` and
  `0.2.2-rc.5`.
- On `0.2.2-rc.5`, a fresh headless process resumed the same persisted
  session by ID. The restored instruction slot was already visible at
  pre-step and the provider received exactly one copy of the rule.

### Write timing, scope eviction, and diagnostics

Eight local stub-provider traces on DSH `0.2.2-rc.5` used candidate
`3a1244e` and the sealed rc.1 engine. Each fixture ran in a separate
temporary headless profile.

- A first direct write to `a/new.md` completed before `a`'s rule appeared
  in the automatic reminder. A separate `read` followed by `edit`
  delivered the rule in the edit request. `norm_collect("a")` followed
  by a new-file write delivered the rule in a tool result before the
  request issued the write.
- Reads of `a/guide.md` through `e/guide.md` produced final scopes
  `[e, d, c, b]` in recency order. The last request had zero copies of
  `a`'s exclusive rule. Every request had exactly one full root body.
- Resuming the same persisted session with a bridge startup failure
  removed the old body and surfaced the fixture's `fake/startup` code.
  Resuming again with the sealed bridge restored one copy of the rule
  and retired the unavailable notice. The earlier five-request probe
  covers empty collection and recoverable collection errors on both
  host endpoints.
- A shell write to `a/shell.md` left the automatic scope at the root
  and produced no post-edit diagnostic, even with a separate invalid
  declaration present. The subsequent explicit collect delivered the
  applicable `a` rule. A successful built-in edit of `a/.norm` that
  introduced malformed YAML delivered soft validation feedback and an
  unavailable notice while retiring the old rule body.
- After a supported edit changed the layout description, the immediate
  provider request still carried its previously assembled layout. The
  following request contained the refreshed description. An external
  change appeared in the collected rule block while the layout section
  retained its cached description. The Skill records this timing.
  [DSH Skill](../../skills/dsh-norm-spec/SKILL.md)
