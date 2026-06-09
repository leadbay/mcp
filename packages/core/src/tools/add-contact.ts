import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext } from "../types.js";
import { leadbay_add_contact as ADD_CONTACT_DESCRIPTION } from "../tool-descriptions.generated.js";

interface AddContactParams {
  // Parent company: the lead's UUID. The created contact attaches here.
  lead_id: string;
  first_name: string;
  last_name: string;
  job_title?: string;
  // LinkedIn profile URL — the reporter's hunch (product#3703): often the
  // only thing a rep has for a person they found by hand.
  linkedin_page?: string;
  email?: string;
  phone_number?: string;
}

interface CreatedContact {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone_number: string | null;
  linkedin_page: string | null;
  job_title: string | null;
  can_enrich?: boolean;
  recommended?: boolean;
  pinned?: boolean;
}

interface AddContactResult {
  added: true;
  lead_id: string;
  contact: CreatedContact;
}

/**
 * Add a single contact to a known company — the in-conversation
 * "create_contact" the reporter asked for (leadbay/product#3703).
 *
 * Backend route: `POST /1.5/leads/{leadId}/contacts` → 200 with the created
 * contact (incl. its new `id`). This is the SAME direct endpoint the Leadbay
 * web UI uses to add a contact — distinct from, and lighter than, the CSV
 * import pipeline (`leadbay_import_and_qualify`), which 401s on some accounts
 * and burns import/qualify quota. One call, no quota, works.
 *
 * The undo is `leadbay_remove_contact` (archives by the contact's own id).
 */
export const addContact: Tool<AddContactParams, AddContactResult> = {
  name: "leadbay_add_contact",
  description: ADD_CONTACT_DESCRIPTION,
  write: true,
  annotations: {
    title: "Add a contact",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  inputSchema: {
    type: "object",
    properties: {
      lead_id: {
        type: "string",
        description:
          "UUID of the parent company (lead) to attach the contact to. The contact is created on this company.",
      },
      first_name: { type: "string", description: "Contact first name." },
      last_name: { type: "string", description: "Contact last name." },
      job_title: { type: "string", description: "Contact job title (optional)." },
      linkedin_page: {
        type: "string",
        description: "Contact LinkedIn profile URL (optional).",
      },
      email: { type: "string", description: "Contact email (optional)." },
      phone_number: {
        type: "string",
        description: "Contact phone number (optional, free-form).",
      },
    },
    required: ["lead_id", "first_name", "last_name"],
    additionalProperties: false,
  },
  execute: async (
    client: LeadbayClient,
    params: AddContactParams,
    _ctx?: ToolContext,
  ): Promise<AddContactResult> => {
    const body: Record<string, unknown> = {
      first_name: params.first_name,
      last_name: params.last_name,
    };
    if (params.job_title != null) body.job_title = params.job_title;
    if (params.linkedin_page != null) body.linkedin_page = params.linkedin_page;
    if (params.email != null) body.email = params.email;
    if (params.phone_number != null) body.phone_number = params.phone_number;

    const contact = await client.request<CreatedContact>(
      "POST",
      `/leads/${params.lead_id}/contacts`,
      body,
    );
    return { added: true, lead_id: params.lead_id, contact };
  },
};
