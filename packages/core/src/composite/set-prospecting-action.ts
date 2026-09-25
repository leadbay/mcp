/**
 * leadbay_set_prospecting_action — turn one of today's prospecting actions on
 * or off for a lead, exactly as the web app's Prospection cell does.
 *
 *   selected: true  → POST   /leads/epilogue            {lead_ids, status}
 *   selected: false → DELETE /leads/{id}/epilogue?type=  (204)
 *
 * The web app treats the four actions as a multi-select over the lead's
 * `epilogue_today_statuses`: several can be on for one day, and each toggles
 * independently. Adding one appends to that list and moves `epilogue_status`;
 * removing one takes that type out of today's list and leaves
 * `epilogue_status` where it was. So "what is selected" is today's list, never
 * `epilogue_status`, which is only the most recent value ever set.
 *
 * No note is written. That is the difference from leadbay_report_outreach,
 * which records that an outreach HAPPENED (note + verification). This sets a
 * flag the rep controls directly, which is why a page's action buttons call
 * it: a tap in a car park, undoable, with nothing left on the timeline.
 */
import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";
import { EPILOGUE_LABEL_MAP } from "../tools/set-epilogue-status.js";

import { leadbay_set_prospecting_action as SET_PROSPECTING_ACTION_DESCRIPTION } from "../tool-descriptions.generated.js";

interface SetProspectingActionParams {
  lead_id: string;
  action: string;
  selected: boolean;
}

export const setProspectingAction: Tool<SetProspectingActionParams> = {
  name: "leadbay_set_prospecting_action",
  annotations: {
    title: "Set or clear a prospecting action",
    readOnlyHint: false,
    // A per-day status flag the rep toggles, like the web app's cell: turning
    // it off is the undo of turning it on, not the loss of a record.
    destructiveHint: false,
    // Turning an action on twice appends it to today's list twice.
    idempotentHint: false,
    openWorldHint: false,
  },
  description: SET_PROSPECTING_ACTION_DESCRIPTION,
  optional: true,
  write: true,
  inputSchema: {
    type: "object",
    properties: {
      lead_id: { type: "string", description: "Lead UUID." },
      action: {
        type: "string",
        enum: [
          "STILL_CHASING",
          "COULD_NOT_REACH_STILL_TRYING",
          "INTEREST_VALIDATED_OR_MEETING_PLANED",
          "NOT_INTERESTED_LOST",
        ],
        description: "The prospecting action. The EPILOGUE_-prefixed form is accepted too.",
      },
      selected: {
        type: "boolean",
        description: "true to turn the action on for today, false to turn it off.",
      },
    },
    required: ["lead_id", "action", "selected"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      lead_id: { type: "string" },
      action: { type: "string", description: "The short form, e.g. STILL_CHASING." },
      selected: { type: "boolean", description: "The state the action is now in." },
    },
    required: ["lead_id", "action", "selected"],
  },
  execute: async (client: LeadbayClient, params: SetProspectingActionParams) => {
    if (!params.lead_id) {
      throw client.makeError("INVALID_PARAMS", "lead_id is required", "Pass the lead's UUID.");
    }
    const wire = EPILOGUE_LABEL_MAP[params.action];
    if (!wire) {
      throw client.makeError(
        "INVALID_PARAMS",
        `Unknown prospecting action: ${params.action}`,
        "Use STILL_CHASING, COULD_NOT_REACH_STILL_TRYING, INTEREST_VALIDATED_OR_MEETING_PLANED or NOT_INTERESTED_LOST.",
      );
    }
    if (typeof params.selected !== "boolean") {
      throw client.makeError("INVALID_PARAMS", "selected must be true or false", "true turns the action on, false turns it off.");
    }

    if (params.selected) {
      await client.requestVoid("POST", "/leads/epilogue", { lead_ids: [params.lead_id], status: wire });
    } else {
      await client.requestVoid(
        "DELETE",
        `/leads/${encodeURIComponent(params.lead_id)}/epilogue?type=${encodeURIComponent(wire)}`,
      );
    }
    return { lead_id: params.lead_id, action: wire.replace(/^EPILOGUE_/, ""), selected: params.selected };
  },
};
