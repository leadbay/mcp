import type { LeadbayClient } from "../client.js";
import type { Tool, EpilogueStatusType } from "../types.js";
import { leadbay_set_epilogue_status as SET_EPILOGUE_STATUS_DESCRIPTION } from "../tool-descriptions.generated.js";

// Short labels accepted by the composite, mapped to the EPILOGUE_* enum the
// backend expects. Keeping a public mapping so callers (and tests) see exactly
// what the wire value will be.
export const EPILOGUE_LABEL_MAP: Record<string, EpilogueStatusType> = {
  STILL_CHASING: "EPILOGUE_STILL_CHASING",
  COULD_NOT_REACH_STILL_TRYING: "EPILOGUE_COULD_NOT_REACH_STILL_TRYING",
  INTEREST_VALIDATED_OR_MEETING_PLANED: "EPILOGUE_INTEREST_VALIDATED_OR_MEETING_PLANED",
  NOT_INTERESTED_LOST: "EPILOGUE_NOT_INTERESTED_LOST",
  // Also accept the long forms verbatim
  EPILOGUE_STILL_CHASING: "EPILOGUE_STILL_CHASING",
  EPILOGUE_COULD_NOT_REACH_STILL_TRYING: "EPILOGUE_COULD_NOT_REACH_STILL_TRYING",
  EPILOGUE_INTEREST_VALIDATED_OR_MEETING_PLANED: "EPILOGUE_INTEREST_VALIDATED_OR_MEETING_PLANED",
  EPILOGUE_NOT_INTERESTED_LOST: "EPILOGUE_NOT_INTERESTED_LOST",
};

interface SetEpilogueStatusParams {
  lead_ids: string[];
  status: string;
}

export const setEpilogueStatus: Tool<SetEpilogueStatusParams> = {
  name: "leadbay_set_epilogue_status",
  annotations: {
    title: "Set lead epilogue status",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: SET_EPILOGUE_STATUS_DESCRIPTION,
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
          "One of: STILL_CHASING, COULD_NOT_REACH_STILL_TRYING, INTEREST_VALIDATED_OR_MEETING_PLANED, NOT_INTERESTED_LOST",
      },
    },
    required: ["lead_ids", "status"],
    additionalProperties: false,
  },
  execute: async (client: LeadbayClient, params: SetEpilogueStatusParams) => {
    const wire = EPILOGUE_LABEL_MAP[params.status];
    if (!wire) {
      return {
        error: true,
        code: "BAD_INPUT",
        message: `Unknown epilogue status: ${params.status}`,
        hint: `Use one of: ${Object.keys(EPILOGUE_LABEL_MAP).filter((k) => !k.startsWith("EPILOGUE_")).join(", ")}`,
      };
    }
    await client.requestVoid("POST", "/leads/epilogue", {
      lead_ids: params.lead_ids,
      status: wire,
    });
    return { applied: true, count: params.lead_ids.length, status: wire };
  },
};
