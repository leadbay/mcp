import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext } from "../types.js";
import { leadbay_pin_contact as PIN_CONTACT_DESCRIPTION } from "../tool-descriptions.generated.js";

/**
 * Replaces the client's generic 404 hint on the pin/unpin endpoints. Shared
 * with unpin-contact.ts so both answer a NOT_FOUND the same way.
 */
export const NOT_PINNABLE_HINT =
  "This contact id is not in your organization's contact directory, so it cannot be pinned or unpinned. " +
  "Almost always it is a `source: \"paid\"` enrichment candidate from leadbay_research_lead_by_id's `candidates` list; " +
  "only `source: \"org\"` contacts are pinnable. The id is not wrong and the tool is not broken, so do NOT retry it. " +
  "To act on this person, enrich them directly with leadbay_enrich_contacts (the lead id + this contact id), " +
  "enrich by job title with leadbay_enrich_titles, or add them with leadbay_add_contact — " +
  "each produces a NEW org contact with a different id, which is pinnable. " +
  "Note that pinning does not decide who gets enriched: leadbay_enrich_titles selects people by job title, leadbay_enrich_contacts by the contact id you pass.";

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
 * surfaces first. Backend: `POST /1.6/contacts/{contactId}/pin` → 204.
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
    try {
      await client.requestVoid("POST", `/contacts/${params.contact_id}/pin`);
    } catch (e: any) {
      // The generic 404 hint is "Verify the ID is correct", which for this
      // endpoint is wrong advice: the id IS correct, it is just a paid
      // candidate rather than an org contact. Agents read that hint as "look
      // it up again and retry" and hammer the endpoint (43 of 48 production
      // pin calls in the 180 days to 2026-09-02 were this 404).
      if (e?.code === "NOT_FOUND") throw { ...e, hint: NOT_PINNABLE_HINT };
      throw e;
    }
    return { pinned: true, contact_id: params.contact_id, action: "pinned" };
  },
};
