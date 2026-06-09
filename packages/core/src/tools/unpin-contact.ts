import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext } from "../types.js";
import { leadbay_unpin_contact as UNPIN_CONTACT_DESCRIPTION } from "../tool-descriptions.generated.js";

interface UnpinContactParams {
  // The contact's own UUID (the `id` on a contact object) — NOT the lead id.
  contact_id: string;
}

interface UnpinContactResult {
  pinned: false;
  contact_id: string;
  action: "unpinned";
}

/**
 * Unpin a contact — the inverse of leadbay_pin_contact. Clears the
 * priority/favourite flag; the contact stays on the company.
 * Backend: `POST /1.5/contacts/{contactId}/unpin` → 204.
 */
export const unpinContact: Tool<UnpinContactParams, UnpinContactResult> = {
  name: "leadbay_unpin_contact",
  description: UNPIN_CONTACT_DESCRIPTION,
  write: true,
  annotations: {
    title: "Unpin a contact",
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
          "UUID of the contact to unpin (the contact's own `id` — NOT the parent lead id).",
      },
    },
    required: ["contact_id"],
    additionalProperties: false,
  },
  execute: async (
    client: LeadbayClient,
    params: UnpinContactParams,
    _ctx?: ToolContext,
  ): Promise<UnpinContactResult> => {
    await client.requestVoid("POST", `/contacts/${params.contact_id}/unpin`);
    return { pinned: false, contact_id: params.contact_id, action: "unpinned" };
  },
};
