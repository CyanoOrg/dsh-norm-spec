/**
 * Host-line compatibility seam (D017).
 *
 * The supported window spans two DSH host lines. rc.6 exposes the session
 * log as a public `events` array, a shared `{ kind: "plugin" }` message
 * source, `start`/`end` surface-replace coordinates, and the
 * `agent/session-start` creation event. The 0.2.0 line renames every one
 * of them: `snapshotEvents()`, per-producer `kind` values ("there is no
 * shared catch-all plugin kind"), `startSeq`/`endSeq`, and
 * `agent/created`. Each cross-line difference lives behind this module —
 * one runtime probe plus structural casts at a single seam — so the
 * adapter body stays line-agnostic and both host lines compile unchanged
 * (the CI host-floor job compiles the same sources against rc.6).
 *
 * Migration note: `snapshotEvents()` is deprecated upstream for NEW
 * callers ("existing logic may remain unmigrated"). Our slot scan predates
 * the deprecation and migrates to maintained projection state together
 * with the Host Adapter SDK convergence (0.3.0 track); the official
 * time-context plugin carries the same deferral.
 */
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { Session, SessionEvent } from "@deepseek-ai/dsh-session";
import { Session as SessionClass } from "@deepseek-ai/dsh-session";

/**
 * True on the 0.2.0 host line. Probed once from the Session prototype:
 * rc.6 has no `snapshotEvents`, 0.2.0 has no public `events` array.
 */
const modernHost =
  typeof (SessionClass.prototype as unknown as Record<string, unknown>)
    .snapshotEvents === "function";

/**
 * Read the session event log across host lines.
 *
 * @param session - the session whose logged events are needed.
 * @returns the events in log order (empty when neither shape is present,
 *   which cannot happen on a supported host).
 */
export function hostSessionEvents(session: Session): readonly SessionEvent[] {
  if (modernHost) {
    const reader = (
      session as unknown as { snapshotEvents?: () => readonly SessionEvent[] }
    ).snapshotEvents;
    return typeof reader === "function" ? reader.call(session) : [];
  }
  const legacy = (session as unknown as { events?: readonly SessionEvent[] })
    .events;
  return legacy ?? [];
}

/**
 * Whether a message source belongs to this plugin on any host line:
 * the rc.6 shared shape (`kind: "plugin"` + `plugin` name) or the 0.2.0
 * per-producer shape (`kind` = the plugin's own name).
 *
 * @param source - the event message source to test.
 * @param pluginName - this plugin's registry name.
 * @returns true when the source names this plugin.
 */
export function isOwnReminderSource(
  source: unknown,
  pluginName: string,
): boolean {
  if (source === null || typeof source !== "object") return false;
  const candidate = source as { kind?: unknown; plugin?: unknown };
  return (
    (candidate.kind === "plugin" && candidate.plugin === pluginName)
    || candidate.kind === pluginName
  );
}

/**
 * Build the plugin-owned message source for the current host line.
 *
 * The returned value is typed `never` so it is assignable to either
 * line's `source` field without per-line conditionals at the call sites;
 * the runtime shape is always a valid source for the detected host.
 *
 * @param pluginName - this plugin's registry name.
 * @param form - `instructions` for the convention reminder, `notice`
 *   for the bounded post-edit feedback account.
 * @param summary - required one-line account when `form` is `notice`.
 * @returns a host-valid message source object.
 */
export function pluginReminderSource(
  pluginName: string,
  form: "instructions",
): never;
export function pluginReminderSource(
  pluginName: string,
  form: "notice",
  summary: string,
): never;
export function pluginReminderSource(
  pluginName: string,
  form: "instructions" | "notice",
  summary?: string,
): never {
  const source = summary === undefined
    ? modernHost
      ? { kind: pluginName, form }
      : { kind: "plugin", plugin: pluginName, form }
    : modernHost
      ? { kind: pluginName, form, summary }
      : { kind: "plugin", plugin: pluginName, form, summary };
  return source as unknown as never;
}

/**
 * Build the single-slot replacement surface operation for the current
 * host line (rc.6 `start`/`end`; 0.2.0 `startSeq`/`endSeq`). Typed
 * `never` for the same single-seam reason as {@link pluginReminderSource}.
 *
 * @param seq - the shadowed event's sequence number.
 * @returns a host-valid `surfaceOp` replace object.
 */
export function replaceSurfaceOp(seq: number): never {
  const op = modernHost
    ? { op: "replace", startSeq: seq, endSeq: seq }
    : { op: "replace", start: seq, end: seq };
  return op as unknown as never;
}

/**
 * Subscribe to the per-agent session creation event across host lines
 * (rc.6 `agent/session-start`; 0.2.0 `agent/created`, whose payload is
 * a superset — creation, resume, clear, or compaction — all of which
 * produce a fresh agent whose bridge this plugin must start).
 *
 * @param ctx - the plugin's Cordis context.
 * @param handler - receives the newly created agent.
 */
export function onAgentSessionStart(
  ctx: Context,
  handler: (payload: { agent: Agent }) => void,
): void {
  if (modernHost) {
    ctx.on("agent/created" as never, handler as never);
  } else {
    ctx.on("agent/session-start" as never, handler as never);
  }
}
