import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext } from "../types.js";
import { leadbay_update_contact as UPDATE_CONTACT_DESCRIPTION } from "../tool-descriptions.generated.js";

interface UpdateContactParams {
  // The contact's own UUID (the `id` on a contact object) — NOT the lead id.
  contact_id: string;
  // first_name + last_name are REQUIRED by the backend even on an edit — the
  // /update endpoint validates the full contact identity and rejects a
  // partial body ("invalid contact"). Pass the existing values for fields you
  // aren't changing.
  first_name: string;
  last_name: string;
  job_title?: string | null;
  linkedin_page?: string | null;
  email?: string | null;
  phone_number?: string | null;
}

interface UpdatedContact {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone_number: string | null;
  linkedin_page: string | null;
  job_title: string | null;
}

interface UpdateContactResult {
  updated: true;
  contact_id: string;
  contact: UpdatedContact;
}

/**
 * Edit an existing contact in place.
 *
 * Backend route: `POST /1.5/contacts/{contactId}/update` → 200 with the
 * updated contact. Keyed by the contact's own id. The body must be snake_case
 * and MUST carry `first_name` + `last_name` — the endpoint validates the full
 * identity and 400s ("invalid contact") on a partial body. So callers pass
 * the contact's current first/last name even when only changing, say, the
 * title; read the current values via leadbay_research_lead_by_id first.
 */
export const updateContact: Tool<UpdateContactParams, UpdateContactResult> = {
  name: "leadbay_update_contact",
  description: UPDATE_CONTACT_DESCRIPTION,
  write: true,
  annotations: {
    title: "Update a contact",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  inputSchema: {
    type: "object",
    properties: {
      contact_id: {
        type: "string",
        description:
          "UUID of the contact to edit (the contact's own `id` — NOT the parent lead id).",
      },
      first_name: {
        type: "string",
        description:
          "Contact first name — REQUIRED even on an edit. Pass the current value if you're not changing it.",
      },
      last_name: {
        type: "string",
        description:
          "Contact last name — REQUIRED even on an edit. Pass the current value if you're not changing it.",
      },
      // Nullable so the agent can CLEAR a field (pass null) as well as set a
      // new value. execute forwards null verbatim; the backend accepts it.
      job_title: {
        type: ["string", "null"],
        description: "Contact job title. Pass null to clear it.",
      },
      linkedin_page: {
        type: ["string", "null"],
        description: "Contact LinkedIn URL. Pass null to clear it.",
      },
      email: {
        type: ["string", "null"],
        description: "Contact email. Pass null to clear it.",
      },
      phone_number: {
        type: ["string", "null"],
        description: "Contact phone (free-form). Pass null to clear it.",
      },
    },
    required: ["contact_id", "first_name", "last_name"],
    additionalProperties: false,
  },
  execute: async (
    client: LeadbayClient,
    params: UpdateContactParams,
    _ctx?: ToolContext,
  ): Promise<UpdateContactResult> => {
    const body: Record<string, unknown> = {
      first_name: params.first_name,
      last_name: params.last_name,
    };
    if (params.job_title !== undefined) body.job_title = params.job_title;
    if (params.linkedin_page !== undefined) body.linkedin_page = params.linkedin_page;
    if (params.email !== undefined) body.email = params.email;
    if (params.phone_number !== undefined) body.phone_number = params.phone_number;

    const contact = await client.request<UpdatedContact>(
      "POST",
      `/contacts/${params.contact_id}/update`,
      body,
    );
    return { updated: true, contact_id: params.contact_id, contact };
  },
};
