import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";
import type { NotePayload } from "../types.js";

interface AddNoteParams {
  leadId: string;
  note: string;
}

export const addNote: Tool<AddNoteParams> = {
  name: "leadbay_add_note",
  description:
    "Add a note to a lead. Notes are visible to the whole organization in Leadbay.",
  optional: true,
  inputSchema: {
    type: "object",
    properties: {
      leadId: {
        type: "string",
        description: "Lead UUID (required)",
      },
      note: {
        type: "string",
        description: "Note text (max 4095 characters)",
      },
    },
    required: ["leadId", "note"],
  },
  execute: async (client: LeadbayClient, params: AddNoteParams) => {
    if (!params.note || params.note.trim().length === 0) {
      throw client.makeError(
        "INVALID_PARAMS",
        "Note cannot be empty",
        "Provide a non-empty note"
      );
    }

    const note = params.note.slice(0, 4095);

    const result = await client.request<NotePayload>(
      "POST",
      `/leads/${params.leadId}/notes`,
      { note }
    );

    return {
      id: result.id,
      note: result.note,
      created_at: result.created_at,
    };
  },
};
