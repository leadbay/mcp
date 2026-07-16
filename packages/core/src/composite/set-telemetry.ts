import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";
import { leadbay_set_telemetry as SET_TELEMETRY_DESCRIPTION } from "../tool-descriptions.generated.js";

interface SetTelemetryParams {
  // enable | disable flip the per-user preference; status reads it without
  // changing anything. Default "status" so a bare call is a safe read.
  // Typed as string (not the enum) because the MCP SDK does not validate the
  // inputSchema enum before dispatch — an unknown value CAN arrive here and is
  // rejected explicitly in execute() rather than mis-treated as disable.
  action?: string;
}

// Whether telemetry is on for the user. The backend defaults the field to true
// (opt-out model); an older backend that doesn't send the field is also treated
// as enabled, matching the LEADBAY_TELEMETRY_ENABLED default-ON contract.
function isEnabled(telemetry_enabled: boolean | undefined): boolean {
  return telemetry_enabled !== false;
}

// The local-install caveat, appended to every "OFF" hint (status, no-op, and
// the changed-disable path). The account flag is honored on the hosted
// connector; a local/stdio process decides telemetry at startup from
// LEADBAY_TELEMETRY_ENABLED and does NOT consult it — so an OFF account flag
// alone does not stop a local install's events (Codex P2). Never claim it does.
const LOCAL_OFF_CAVEAT =
  " On a local (self-hosted / stdio) install, also set LEADBAY_TELEMETRY_ENABLED=false to stop events there — the account flag alone does not.";

const VALID_ACTIONS = ["enable", "disable", "status"] as const;

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

    // Validate the action explicitly (Codex P2): the MCP SDK does NOT enforce
    // the inputSchema enum before dispatch, so without this an unknown string
    // like "check" would fall through the `action === "enable"` test below and
    // be treated as DISABLE — silently opting the user out. Reject anything
    // outside the enum instead of mutating.
    if (!(VALID_ACTIONS as readonly string[]).includes(action)) {
      return {
        error: true,
        code: "BAD_ACTION",
        message: `Unknown action "${action}".`,
        hint: `Use one of: ${VALID_ACTIONS.join(", ")}. Defaults to "status".`,
      };
    }

    // Read the current value FRESH — resolveMe(true) bypasses the 60s cache
    // (Codex P2). A cached read could reflect a telemetry_enabled changed from
    // another connector/web session, making `status` report the wrong state or
    // an enable/disable wrongly no-op as "already ON/OFF" while the backend is
    // the opposite. Also the whole job for `status`.
    const meBefore = await client.resolveMe(true);
    const currentlyEnabled = isEnabled(meBefore.telemetry_enabled);

    if (action === "status") {
      return {
        telemetry_enabled: currentlyEnabled,
        changed: false,
        action,
        region: client.region,
        hint: currentlyEnabled
          ? "Telemetry is ON. Call with action:'disable' to opt out."
          : "Telemetry is OFF for your account. Call with action:'enable' to opt back in." + LOCAL_OFF_CAVEAT,
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
          : "Telemetry was already OFF for your account; nothing to change. Call leadbay_set_telemetry with action:'enable' to opt back in." + LOCAL_OFF_CAVEAT,
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
      // reads it per-request; a local/stdio install needs the env var (see
      // LOCAL_OFF_CAVEAT). Never imply the account flag alone stops local events.
      hint: target
        ? "Telemetry is now ON for your account — thanks for helping improve Leadbay."
        : "Telemetry is now OFF for your account — the hosted Leadbay connector stops sending your product-usage events." + LOCAL_OFF_CAVEAT,
    };
  },
};
