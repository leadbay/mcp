import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext } from "../types.js";
import { getLeadProfile } from "../tools/get-lead-profile.js";
import { getContacts } from "../tools/get-contacts.js";
import { enrichContacts } from "../tools/enrich-contacts.js";

interface PrepareOutreachParams {
  leadId: string;
  enrich?: boolean;
}

export const prepareOutreach: Tool<PrepareOutreachParams> = {
  name: "leadbay_prepare_outreach",
  description:
    "Prepare an outreach package for a lead: returns the recommended contact (best match by job title), their enriched email/phone (if available), and the lead's AI summary. If enrich=true and credits are available, will trigger enrichment on the recommended contact and return the ID to poll later. Write action — requires user-level permission.",
  optional: true,
  inputSchema: {
    type: "object",
    properties: {
      leadId: {
        type: "string",
        description: "Lead UUID (required)",
      },
      enrich: {
        type: "boolean",
        description:
          "If true and credits available, trigger enrichment on the recommended contact (default: false). Enrichment is async — poll leadbay_get_contacts after ~60s.",
      },
    },
    required: ["leadId"],
  },
  execute: async (
    client: LeadbayClient,
    params: PrepareOutreachParams,
    ctx?: ToolContext
  ) => {
    const contactsResult = await getContacts.execute(
      client,
      { leadId: params.leadId },
      ctx
    );
    const contacts = contactsResult.contacts as Array<{
      id: string;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      phone_number: string | null;
      linkedin_page: string | null;
      job_title: string | null;
      recommended: boolean;
      source: "org" | "paid";
    }>;

    const recommended = contacts.find((c) => c.recommended) ?? contacts[0];

    let enrichmentTriggered = false;
    let enrichmentError: string | null = null;
    if (params.enrich && recommended) {
      try {
        await enrichContacts.execute(
          client,
          { leadId: params.leadId, contactId: recommended.id },
          ctx
        );
        enrichmentTriggered = true;
      } catch (e: any) {
        enrichmentError = e?.message ?? String(e);
      }
    }

    // Also fetch a short profile for AI summary context
    let leadSummary: { name: string; ai_summary: string | null; website: string | null } | null =
      null;
    try {
      const profile = await getLeadProfile.execute(
        client,
        { leadId: params.leadId },
        ctx
      );
      leadSummary = {
        name: (profile.lead as any).name,
        ai_summary: (profile.lead as any).ai_summary,
        website: (profile.lead as any).website,
      };
    } catch {}

    return {
      lead: leadSummary,
      recommended_contact: recommended
        ? {
            id: recommended.id,
            name: [recommended.first_name, recommended.last_name]
              .filter(Boolean)
              .join(" "),
            job_title: recommended.job_title,
            email: recommended.email,
            phone_number: recommended.phone_number,
            linkedin_page: recommended.linkedin_page,
          }
        : null,
      other_contacts_count: Math.max(0, contacts.length - 1),
      enrichment: {
        triggered: enrichmentTriggered,
        error: enrichmentError,
        hint: enrichmentTriggered
          ? "Enrichment started. Poll leadbay_get_contacts with the same leadId in ~60 seconds."
          : null,
      },
    };
  },
};
