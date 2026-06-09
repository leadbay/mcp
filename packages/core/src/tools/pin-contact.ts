import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext } from "../types.js";
import { leadbay_pin_contact as PIN_CONTACT_DESCRIPTION } from "../tool-descriptions.generated.js";

interface PinContactParams {
  // The contact's own UUID (the `id` on a contact object) — NOT the lead id.
  contact_id: string;
}

interface PinContactResult {
  pinned: boolean;
  contact_id: string;
  action: "pinned" | "unpinned";
}

/**
 * Pin a contact — marks it as a priority/favourite on the company so it
 * surfaces first. Backend: `POST /1.5/contacts/{contactId}/pin` → 204.
 * Keyed by the contact's own id. The inverse is leadbay_unpin_contact.
 */
export const pinContact: Tool<PinContactParams, PinContactResult> = {
  name: "leadbay_pin_contact",
  description: PIN_CONTACT_DESCRIPTION,
  write: true,
  annotations: {
    title: "Pin a contact",
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
          "UUID of the contact to pin (the contact's own `id` — NOT the parent lead id).",
      },
    },
    required: ["contact_id"],
    additionalProperties: false,
  },
  execute: async (
    client: LeadbayClient,
    params: PinContactParams,
    _ctx?: ToolContext,
  ): Promise<PinContactResult> => {
    await client.requestVoid("POST", `/contacts/${params.contact_id}/pin`);
    return { pinned: true, contact_id: params.contact_id, action: "pinned" };
  },
};
