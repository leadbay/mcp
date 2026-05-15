import type { LeadbayClient } from "../client.js";
import type { Tool, NotePayload } from "../types.js";
import { leadbay_get_lead_notes as GET_LEAD_NOTES_DESCRIPTION } from "../tool-descriptions.generated.js";

interface GetLeadNotesParams {
  leadId: string;
}

export const getLeadNotes: Tool<GetLeadNotesParams> = {
  name: "leadbay_get_lead_notes",
  annotations: {
    title: "Read lead notes",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: GET_LEAD_NOTES_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: { leadId: { type: "string", description: "Lead UUID (required)" } },
    required: ["leadId"],
    additionalProperties: false,
  },
  execute: async (client: LeadbayClient, params: GetLeadNotesParams) => {
    return await client.request<NotePayload[]>(
      "GET",
      `/leads/${params.leadId}/notes`
    );
  },
};
