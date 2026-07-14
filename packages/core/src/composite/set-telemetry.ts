import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";
import { leadbay_set_telemetry as SET_TELEMETRY_DESCRIPTION } from "../tool-descriptions.generated.js";

interface SetTelemetryParams {
  // enable | disable flip the per-user preference; status reads it without
  // changing anything. Default "status" so a bare call is a safe read.
  action?: "enable" | "disable" | "status";
}

// Whether telemetry is on for the user. The backend defaults the field to true
// (opt-out model); an older backend that doesn't send the field is also treated
// as enabled, matching the LEADBAY_TELEMETRY_ENABLED default-ON contract.
function isEnabled(telemetry_enabled: boolean | undefined): boolean {
  return telemetry_enabled !== false;
}

export const setTelemetry: Tool<SetTelemetryParams> = {
  name: "leadbay_set_telemetry",
  annotations: {
    title: "Enable, disable, or check product-usage telemetry",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: SET_TELEMETRY_DESCRIPTION,
  optional: true,
  write: true,
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["enable", "disable", "status"],
        description:
          "enable / disable flip telemetry for the user; status just reports the current setting. Defaults to status.",
      },
    },
    additionalProperties: false,
  },
  // No outputSchema: the result is a small self-describing object (telemetry_enabled,
  // changed, action, region, hint — all documented in the description). Declaring
  // an outputSchema would opt this tool into the structuredContent conformance
  // suite for no benefit here.
  execute: async (client: LeadbayClient, params: SetTelemetryParams) => {
    const action = params.action ?? "status";

    // Current value first (also the whole job for `status`). resolveMe is
    // 60s-cached; we invalidate after a write so the post-write read is fresh.
    const meBefore = await client.resolveMe();
    const currentlyEnabled = isEnabled(meBefore.telemetry_enabled);

    if (action === "status") {
      return {
        telemetry_enabled: currentlyEnabled,
        changed: false,
        action,
        region: client.region,
        hint: currentlyEnabled
          ? "Telemetry is ON. Call with action:'disable' to opt out."
          : "Telemetry is OFF. Call with action:'enable' to opt back in.",
      };
    }

    const target = action === "enable";
    if (target === currentlyEnabled) {
      // Idempotent no-op — don't hit the backend just to write the same value.
      return {
        telemetry_enabled: currentlyEnabled,
        changed: false,
        action,
        region: client.region,
        hint: target
          ? "Telemetry was already ON; nothing to change. Call leadbay_set_telemetry with action:'disable' to opt out."
          : "Telemetry was already OFF; nothing to change. Call leadbay_set_telemetry with action:'enable' to opt back in.",
      };
    }

    await client.requestVoid("POST", "/users/telemetry", {
      telemetry_enabled: target,
    });
    // The /me cache holds telemetry_enabled; invalidate so the next read (here
    // and elsewhere) reflects the flip.
    client.invalidateMe();

    return {
      telemetry_enabled: target,
      changed: true,
      action,
      region: client.region,
      // Honest about WHERE the account flag is enforced: the hosted connector
      // reads it per-request. A local (stdio) install decides telemetry at
      // process start from LEADBAY_TELEMETRY_ENABLED and does NOT consult this
      // account flag, so we make NO local-opt-out promise — we point local users
      // at the env var instead of implying the flag governs them.
      hint: target
        ? "Telemetry is now ON for your account — thanks for helping improve Leadbay."
        : "Telemetry is now OFF for your account — the hosted Leadbay connector stops sending your product-usage events. On a local (self-hosted / stdio) install, also set LEADBAY_TELEMETRY_ENABLED=false to stop events there.",
    };
  },
};
