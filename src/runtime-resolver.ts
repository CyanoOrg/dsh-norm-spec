import { type BridgeLaunch, BridgeClientError } from "./bridge-client.ts";

/**
 * Resolve the session bridge launch for the local development milestone.
 *
 * The production distribution bundles the sealed upstream payload and the
 * platform bridge binary inside the npm package (pi-norm-spec D012 pattern).
 * Until packaging exists, development resolves from explicit environment
 * overrides so the plugin never silently falls back to a `PATH` norm.
 */
export async function resolvePlatformRuntime(): Promise<BridgeLaunch> {
  const bridge = process.env.DSH_NORM_BRIDGE;
  const payload = process.env.DSH_NORM_PAYLOAD;
  if (bridge === undefined || bridge.length === 0) {
    throw new BridgeClientError(
      "dsh-norm-spec/runtime/package-unavailable",
      "no bundled runtime yet: set DSH_NORM_BRIDGE and DSH_NORM_PAYLOAD for local development",
    );
  }
  if (payload === undefined || payload.length === 0) {
    throw new BridgeClientError(
      "dsh-norm-spec/runtime/locator-invalid",
      "DSH_NORM_BRIDGE is set but DSH_NORM_PAYLOAD is missing",
    );
  }
  return { command: bridge, args: ["serve", "--payload", payload] };
}
