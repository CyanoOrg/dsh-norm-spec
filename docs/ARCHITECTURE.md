# Architecture

## Boundary

dsh-norm-spec is a hybrid package because DeepSeek Harness (DSH) loads
Cordis plugins as TypeScript. Rust owns computation; TypeScript owns host
adaptation.

```text
DSH Cordis plugin (ctx)
      │
      ▼
src/index.ts (apply)         event mapping, cancellation, UI
      │ JSON/JSONL over stdio
      ▼
dsh-norm-bridge              process protocol and lifecycle
      ├──────────────────────► bundled norm executable
      │                        collect, validate, compatibility
      │                                  │
      │                                  │ normalized machine responses
      ▼                                  ▼
dsh-norm-engine              prompt context; future typed policy
```

## Host surface (DSH rc.6, verified against @deepseek-ai/dsh 0.1.0-rc.6)

The plugin adapts five DSH surfaces:

| Surface | Mode | dsh-norm-spec use |
|---|---|---|
| `agent/session-start` | emit | Start the session-scoped bridge child |
| `agent/pre-step` | waterfall | Inject the collected `.norm` prompt context |
| `tools/result` | emit | Track the active target from read/write/edit paths |
| `tools/post-execute` | waterfall | Post-edit validation feedback on write/edit |
| `ctx.tools.register` | — | `norm_validate` / `norm_collect` / `norm_scan` native tools |

Injection model follows the DSH `agent-instructions` idiom: one durable
user-role `<system-reminder>` message with a typed source, SHA-1 content
digest for re-injection suppression, and most-specific-first ordering. It
does NOT follow pi's per-turn deep-copy model — DSH rc.6 has no
per-provider-turn context-copy event, and durable injection is
KV-cache-friendly.

## Hard constraint: no custom session event types

DSH Discussion #1584 (rc.6): `dsh-session` validates persisted logs against
a static list of known event types. A plugin appending a custom session
event makes the entire session log unloadable. dsh-norm-spec therefore:

- never calls `session.append` with a custom type;
- keeps all model-visible output in standard user messages and tool
  results;
- records adapter diagnostics only in plugin logs, not the session log.

## `dsh-norm-engine`

Consumes normalized, versioned norm-spec data and calculates active prompt
context. It does not parse YAML or traverse `.norm` inheritance itself.
It produces `dsh-norm-spec/prompt-context/v1`: a deterministic, bounded
projection containing the complete normalized frontmatter and Markdown
body for every collected convention, most-specific-first, failing rather
than truncating.

## `dsh-norm-bridge`

Versioned JSON/JSONL framing between Node.js and Rust under the
`dsh-norm-spec/bridge/v1` identifier. It owns request correlation,
protocol errors, cancellation, and process-level diagnostics. It invokes
the verified upstream `norm` CLI rather than linking norm-spec crates.
Protocol shape mirrors `pi-norm-spec/bridge/v1` (methods: status,
collect, promptContext, validate, cancel, shutdown) with the
`dsh-norm-spec` error-code namespace; see docs/BRIDGE-PROTOCOL.md.

The bridge is forked from pi-norm-spec's `pi-norm-bridge`/`pi-norm-engine`
with mechanical namespace renaming (pi-norm-spec → dsh-norm-spec, prompt
context API id, error-code prefixes). Divergence is intentional and
recorded in docs/decisions.md; when the Host Adapter SDK is extracted
(2026-08-14 strategy discussion §7), both adapters converge on one shared
implementation.

## Upstream runtime

The adapter consumes norm-spec through its CLI machine boundary (D005
pattern). Compatibility discovery is mandatory before collect or validate
output is trusted. Distribution bundles the sealed upstream payload with
the bridge binary in one npm package (no platform matrix in the first
local milestone; platform packages follow the pi-norm-spec D012 pattern
when publishing).

## TypeScript plugin

`src/index.ts` exports `apply(ctx, config)` and stays thin: event
registration, input projection, bridge calls, cancellation, and
user-facing messages only. It never parses `.norm`, walks inheritance,
validates schemas, or duplicates policy evaluation. Bridge failures are
visible and never become an empty convention set.

## Enforcement boundary

Mirrors pi-norm-spec D010: the hard-enforcement subset is empty. No
blocking `tools/pre-execute` deny is registered from prose `.norm`
declarations. Prompt context is guidance; post-edit validation is soft
feedback. `tools/pre-execute` guard APIs exist in DSH but require a
closed typed operation-policy declaration upstream, which does not exist
yet.

## Process model

One persistent `dsh-norm-bridge` child per DSH agent session. Started on
`agent/session-start`, waits for the versioned `ready` event, shut down
on plugin disposal. Same failure policy as pi-norm-spec D008: malformed
frame, startup failure, unexpected EOF, or non-zero exit rejects pending
work and becomes visible state; no silent fallback or restart.
