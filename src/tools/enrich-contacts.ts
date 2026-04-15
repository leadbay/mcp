import type { LeadbayClient } from "../client.js";
import type { OrgPayload, UserMePayload } from "../types.js";

export function registerEnrichContacts(api: any, client: LeadbayClient) {
  api.registerTool({
    name: "leadbay_enrich_contacts",
    description:
      "Order email and/or phone enrichment for a specific contact on a lead. Tip: the recommended contact from leadbay_discover_leads or leadbay_get_lead_profile is the person with the most fitting job title — enrich them first. Enrichment is asynchronous — use leadbay_get_contacts after about 60 seconds to retrieve results. Checks quota before enriching.",
    optional: true,
    parameters: {
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
    },
    execute: async (params: {
      leadId: string;
      contactId: string;
      email?: boolean;
      phone?: boolean;
    }) => {
      const email = params.email ?? true;
      const phone = params.phone ?? true;

      if (!email && !phone) {
        throw client.makeError(
          "INVALID_PARAMS",
          "At least one of email or phone must be true",
          "Set email=true or phone=true"
        );
      }

      // Advisory quota check
      let creditsRemaining: number | null = null;
      try {
        const me = await client.request<UserMePayload>("GET", "/users/me");
        creditsRemaining = me.organization.billing?.ai_credits ?? null;
        if (creditsRemaining !== null && creditsRemaining <= 0) {
          throw client.makeError(
            "QUOTA_EXCEEDED",
            "No enrichment credits remaining",
            "Purchase more credits at app.leadbay.ai"
          );
        }
      } catch (e: any) {
        if (e?.code === "QUOTA_EXCEEDED") throw e;
        // Advisory check failed, proceed anyway — server will enforce
      }

      // Try paid contact enrichment path first
      const enrichPath = `/leads/${params.leadId}/enrich/contacts/${params.contactId}/enrich?email=${email}&phone=${phone}`;
      try {
        await client.request("POST", enrichPath);
      } catch (e: any) {
        if (e?.code === "NOT_FOUND") {
          // Fall back to org contact enrichment path
          const orgPath = `/leads/${params.leadId}/contacts/${params.contactId}/enrich?email=${email}&phone=${phone}`;
          await client.request("POST", orgPath);
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
  });
}
