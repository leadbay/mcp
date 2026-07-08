import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";
import type { UserMePayload } from "../types.js";
import { isUnlimitedAccount, UNLIMITED } from "../composite/_credits-helpers.js";
import { leadbay_enrich_contacts as ENRICH_CONTACTS_DESCRIPTION } from "../tool-descriptions.generated.js";

interface EnrichContactsParams {
  leadId: string;
  contactId: string;
  email?: boolean;
  phone?: boolean;
}

export const enrichContacts: Tool<EnrichContactsParams> = {
  name: "leadbay_enrich_contacts",
  annotations: {
    title: "Enrich contacts for a lead",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: ENRICH_CONTACTS_DESCRIPTION,
  optional: true,
  inputSchema: {
    type: "object",
    properties: {
      leadId: {
        type: "string",
        description: "Lead UUID (required)",
      },
      contactId: {
        type: "string",
        description: "Contact UUID (required)",
      },
      email: {
        type: "boolean",
        description: "Enrich email address (default: true)",
      },
      phone: {
        type: "boolean",
        description: "Enrich phone number (default: true)",
      },
    },
    required: ["leadId", "contactId"],
    additionalProperties: false,
  },
  execute: async (client: LeadbayClient, params: EnrichContactsParams) => {
    const email = params.email ?? true;
    const phone = params.phone ?? true;

    if (!email && !phone) {
      throw client.makeError(
        "INVALID_PARAMS",
        "At least one of email or phone must be true",
        "Set email=true or phone=true"
      );
    }

    // Enrichment (email / phone reveals) is gated by QUOTA server-side — the
    // backend returns 429 / QUOTA_EXCEEDED when the user's daily/weekly/monthly
    // window is actually exhausted. We do NOT pre-refuse client-side: the old
    // `billing.ai_credits <= 0` block was wrong (ai_credits is credits
    // CONSUMED, an accumulator that starts at 0 — not the remaining balance), so
    // it falsely blocked freemium accounts that had quota left but hadn't spent
    // yet. The credit balance is advisory context only, never a gate.
    let creditsRemaining: number | typeof UNLIMITED | null = null;
    try {
      const me = await client.request<UserMePayload>("GET", "/users/me");
      // Internal/unlimited accounts (@leadbay.ai, billing disabled) surface as
      // "unlimited" so the agent stays silent on credits (product#3851).
      creditsRemaining = isUnlimitedAccount(me)
        ? UNLIMITED
        : me.organization.billing?.ai_credits ?? null;
    } catch {
      // Advisory read failed — proceed; the server enforces quota via 429.
    }

    // Try paid contact enrichment path first
    const enrichPath = `/leads/${params.leadId}/enrich/contacts/${params.contactId}/enrich?email=${email}&phone=${phone}`;
    try {
      await client.requestVoid("POST", enrichPath);
    } catch (e: any) {
      if (e?.code === "NOT_FOUND") {
        // Fall back to org contact enrichment path
        const orgPath = `/leads/${params.leadId}/contacts/${params.contactId}/enrich?email=${email}&phone=${phone}`;
        await client.requestVoid("POST", orgPath);
      } else {
        throw e;
      }
    }

    return {
      triggered: true,
      contact_id: params.contactId,
      email_requested: email,
      phone_requested: phone,
      credits_remaining: creditsRemaining,
      hint: "Enrichment started. Use leadbay_get_contacts after ~60 seconds to check results.",
    };
  },
};
