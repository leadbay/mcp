import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext } from "../types.js";
import { leadbay_remove_contact as REMOVE_CONTACT_DESCRIPTION } from "../tool-descriptions.generated.js";

interface RemoveContactParams {
  // The contact's own UUID (the `id` field on a contact returned by
  // leadbay_research_lead_by_id / get_contacts). NOT the parent lead id —
  // the archive endpoint is keyed by contact id directly.
  contact_id: string;
}

interface RemoveContactResult {
  archived: true;
  contact_id: string;
  action: "archived";
}

/**
 * Remove (archive) a single contact from a company — the undo for the
 * add-a-contact path (leadbay_add_contact).
 *
 * Backend route: `POST /1.5/contacts/{contactId}/archive` → 204. This is the
 * exact call the Leadbay web UI fires from its contact "delete" action;
 * archive is a soft-delete (the contact leaves the company's active list).
 * The endpoint is keyed by the contact's OWN id, not nested under the lead.
 */
export const removeContact: Tool<RemoveContactParams, RemoveContactResult> = {
  name: "leadbay_remove_contact",
  description: REMOVE_CONTACT_DESCRIPTION,
  write: true,
  annotations: {
    title: "Remove a contact",
    readOnlyHint: false,
    // Soft-delete (archive), but it does remove the contact from the active
    // list, so flag it destructive so cautious clients can confirm.
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  inputSchema: {
    type: "object",
    properties: {
      contact_id: {
        type: "string",
        description:
          "UUID of the contact to remove (the contact's own `id`, e.g. from leadbay_research_lead_by_id's contacts list — NOT the parent lead id).",
      },
    },
    required: ["contact_id"],
    additionalProperties: false,
  },
  execute: async (
    client: LeadbayClient,
    params: RemoveContactParams,
    _ctx?: ToolContext,
  ): Promise<RemoveContactResult> => {
    await client.requestVoid(
      "POST",
      `/contacts/${params.contact_id}/archive`,
    );
    return { archived: true, contact_id: params.contact_id, action: "archived" };
  },
};
