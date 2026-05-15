import type { LeadbayClient } from "../client.js";
import type { Tool, EpilogueResponsesPayload } from "../types.js";
import { leadbay_get_epilogue_responses as GET_EPILOGUE_RESPONSES_DESCRIPTION } from "../tool-descriptions.generated.js";

interface GetEpilogueResponsesParams {
  leadId: string;
  count?: number;
  page?: number;
}

export const getEpilogueResponses: Tool<GetEpilogueResponsesParams> = {
  name: "leadbay_get_epilogue_responses",
  annotations: {
    title: "Read epilogue responses",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: GET_EPILOGUE_RESPONSES_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      leadId: { type: "string", description: "Lead UUID (required)" },
      count: { type: "number", description: "Items per page (1-200, default 20)" },
      page: { type: "number", description: "Page number, 0-indexed (default 0)" },
    },
    required: ["leadId"],
    additionalProperties: false,
  },
  execute: async (
    client: LeadbayClient,
    params: GetEpilogueResponsesParams
  ) => {
    const count = params.count ?? 20;
    const page = params.page ?? 0;
    return await client.request<EpilogueResponsesPayload>(
      "GET",
      `/leads/${params.leadId}/epilogue_responses?count=${count}&page=${page}`
    );
  },
};
