# Bridge Protocol

`dsh-norm-spec/bridge/v1` is the process contract between the TypeScript
DSH plugin and one session-scoped `dsh-norm-bridge` child. It mirrors
`pi-norm-spec/bridge/v1` with the `dsh-norm-spec` namespace; semantics are
identical unless a difference is stated here. It does not define `.norm`
syntax or validation semantics.

## Transport

- The plugin starts `dsh-norm-bridge serve --payload <sealed-payload>`.
- Standard input and standard output carry UTF-8 newline-delimited JSON.
- Every input frame must end with `\n` and may contain at most 1 MiB
  including the terminator.
- Request IDs contain 1–128 UTF-8 bytes and are unique within one session.
  A session accepts at most 65,536 unique IDs.
- The bridge permits one active collect, prompt-context, or validate
  operation. Control requests remain available while that operation runs.

## Events

The first successful output is `ready`; it binds the exact sealed payload
and the complete upstream compatibility identity:

```json
{"apiVersion":"dsh-norm-spec/bridge/v1","type":"event","event":"ready","payload":{"tag":"v0.1.0-rc.1"},"compatibility":{"apiVersion":"norm-spec/compatibility/v1"}}
```

Payload or handshake failure emits `startupFailed` and exits non-zero.
Invalid framing, protocol mismatch, reused IDs, unexpected input closure,
and internal correlation failures emit `fatal` and exit non-zero.

## Requests

Every request has the common fields below:

```json
{"apiVersion":"dsh-norm-spec/bridge/v1","type":"request","id":"request-1","method":"status"}
```

Supported methods:

| Method | Parameters | Behavior |
|---|---|---|
| `status` | none | Return the active sealed payload identity. |
| `collect` | `root`, `target` | Run the verified upstream collect protocol. |
| `promptContext` | `root`, `target` | Collect and render `dsh-norm-spec/prompt-context/v1` for DSH injection. |
| `validate` | `root` | Run strict upstream validation for all `.norm` files. |
| `cancel` | `requestId` | Cancel exactly one active semantic request. |
| `shutdown` | none | Cancel active work if needed, acknowledge, then exit zero. |

Unknown methods, invalid parameters, a second concurrent semantic
operation, or cancellation of a non-active request return a request-scoped
error and do not change the bridge lifecycle.

## Responses

Every request receives exactly one terminal response with the same ID:

```json
{"apiVersion":"dsh-norm-spec/bridge/v1","type":"response","id":"request-1","status":"ok","result":{}}
{"apiVersion":"dsh-norm-spec/bridge/v1","type":"response","id":"request-2","status":"error","error":{"code":"dsh-norm-spec/bridge/busy","message":"another upstream operation is already active","path":null}}
{"apiVersion":"dsh-norm-spec/bridge/v1","type":"response","id":"request-3","status":"cancelled"}
```

`cancel` has its own request ID. When accepted, its `ok` result names the
target and the target later receives `cancelled`. A shutdown received
during active work emits the work's terminal response before the shutdown
acknowledgement.

## Failure policy

The plugin must reject all pending promises on `startupFailed`, `fatal`,
malformed output, unexpected EOF, or non-zero exit. It must not synthesize
an empty collection, start a one-shot fallback, or silently restart the
child.

## Prompt context envelope

`dsh-norm-spec/prompt-context/v1` result:

```json
{
  "apiVersion": "dsh-norm-spec/prompt-context/v1",
  "target": "<resolved target path>",
  "conventionPaths": ["<most-specific-first>"],
  "prompt": "<rendered conventions> | null"
}
```

`prompt` is null exactly when `conventionPaths` is empty (typed empty
state). Rendered UTF-8 prompt is limited to 256 KiB and fails with a
stable error rather than truncating.
