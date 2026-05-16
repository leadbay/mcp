import type { LeadbayClient } from "../client.js";
import type { Tool, PushbackStatusType } from "../types.js";
import { leadbay_set_pushback as SET_PUSHBACK_DESCRIPTION } from "../tool-descriptions.generated.js";

// Short labels accepted by the composite, mapped to the PUSHBACK_* enum the
// backend expects. Mirrors set-epilogue-status.ts: keep a public mapping so
// callers (and tests) see exactly what the wire value will be.
export const PUSHBACK_LABEL_MAP: Record<string, PushbackStatusType> = {
  "3": "PUSHBACK_3",
  "6": "PUSHBACK_6",
  "12": "PUSHBACK_12",
  "3m": "PUSHBACK_3",
  "6m": "PUSHBACK_6",
  "12m": "PUSHBACK_12",
  "3_months": "PUSHBACK_3",
  "6_months": "PUSHBACK_6",
  "12_months": "PUSHBACK_12",
  PUSHBACK_3: "PUSHBACK_3",
  PUSHBACK_6: "PUSHBACK_6",
  PUSHBACK_12: "PUSHBACK_12",
};

interface SetPushbackParams {
  lead_ids: string[];
  status: string;
}

export const setPushback: Tool<SetPushbackParams> = {
  name: "leadbay_set_pushback",
  annotations: {
    title: "Pushback (snooze) leads for 3 / 6 / 12 months",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: SET_PUSHBACK_DESCRIPTION,
  optional: true,
  write: true,
  inputSchema: {
    type: "object",
    properties: {
      lead_ids: {
        type: "array",
        items: { type: "string" },
        description: "Lead UUIDs (1-1000)",
      },
      status: {
        type: "string",
        description:
          "One of: 3, 6, 12 (months) — or the long form PUSHBACK_3 / PUSHBACK_6 / PUSHBACK_12.",
      },
    },
    required: ["lead_ids", "status"],
    additionalProperties: false,
  },
  execute: async (client: LeadbayClient, params: SetPushbackParams) => {
    const wire = PUSHBACK_LABEL_MAP[String(params.status)];
    if (!wire) {
      return {
        error: true,
        code: "BAD_INPUT",
        message: `Unknown pushback status: ${params.status}`,
        hint: "Use one of: 3, 6, 12 (months) — or PUSHBACK_3 / PUSHBACK_6 / PUSHBACK_12.",
      };
    }
    await client.requestVoid("POST", "/leads/pushback", {
      lead_ids: params.lead_ids,
      status: wire,
    });
    return { applied: true, count: params.lead_ids.length, status: wire };
  },
};
