import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";
import type { NotePayload } from "../types.js";

interface AddNoteParams {
  leadId: string;
  note: string;
}

export const addNote: Tool<AddNoteParams> = {
  name: "leadbay_add_note",
  annotations: {
    title: "Add a note on a lead",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  description:
    "Add a note to a lead. Notes are visible to the whole organization in Leadbay. " +
    "When to use: low-level — for free-form notes not tied to outreach actions. " +
    "When NOT to use: to log an outreach action — use leadbay_report_outreach, which requires verification " +
    "(gmail/calendar/user_confirmed) to prevent hallucinated outreach poisoning the SDR pipeline.",
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
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "Note id assigned by the backend." },
      note: { type: "string", description: "Echoed note text (truncated to 4095 chars)." },
      created_at: { type: "string", description: "ISO timestamp of creation." },
    },
    required: ["id", "note", "created_at"],
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
