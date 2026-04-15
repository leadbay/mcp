import type { LeadbayClient } from "../client.js";
import type {
  LeadPayload,
  AiAgentResponse,
  ContactPayload,
  PaidContactPayload,
  LeadWebFetchPayload,
} from "../types.js";

export function registerGetLeadProfile(api: any, client: LeadbayClient) {
  api.registerTool({
    name: "leadbay_get_lead_profile",
    description:
      "Get a full lead profile including company details, AI qualification scores, web insights (company profile, business signals, prospecting clues, key people, technologies), and contacts with recommended contact highlighted. Bundles multiple API calls into one response. If some data is unavailable, partial results are still returned.",
    parameters: {
      type: "object",
      properties: {
        leadId: {
          type: "string",
          description: "Lead UUID (required)",
        },
        lensId: {
          type: "number",
          description: "Lens ID (optional, auto-resolves to active lens)",
        },
      },
      required: ["leadId"],
    },
    execute: async (params: { leadId: string; lensId?: number }) => {
      const lensId = params.lensId ?? (await client.resolveDefaultLens());

      const [leadResult, qualResult, contactsResult, paidContactsResult, webFetchResult] =
        await Promise.allSettled([
          client.request<LeadPayload>(
            "GET",
            `/lenses/${lensId}/leads/${params.leadId}`
          ),
          client.request<AiAgentResponse[]>(
            "GET",
            `/leads/${params.leadId}/ai_agent_responses`
          ),
          client.request<ContactPayload[]>(
            "GET",
            `/leads/${params.leadId}/contacts?IncludeEnriched=true`
          ),
          client.request<PaidContactPayload[]>(
            "GET",
            `/leads/${params.leadId}/enrich/contacts?IncludeEnriched=true`
          ),
          client.request<LeadWebFetchPayload>(
            "GET",
            `/leads/${params.leadId}/web_fetch`
          ),
        ]);

      if (leadResult.status === "rejected") {
        throw leadResult.reason;
      }

      const lead = leadResult.value;

      const qualification =
        qualResult.status === "fulfilled" ? qualResult.value : null;

      const orgContacts =
        contactsResult.status === "fulfilled" ? contactsResult.value : [];

      const paidContacts =
        paidContactsResult.status === "fulfilled"
          ? paidContactsResult.value
          : [];

      const webFetch =
        webFetchResult.status === "fulfilled" ? webFetchResult.value : null;

      // Merge org contacts and paid contacts, deduplicating by name
      const allContacts = [
        ...orgContacts.map((c) => ({
          id: c.id,
          first_name: c.first_name,
          last_name: c.last_name,
          email: c.email,
          phone_number: c.phone_number,
          linkedin_page: c.linkedin_page,
          job_title: c.job_title,
          recommended: c.recommended,
          enrichment: c.enrichment,
          source: "org" as const,
        })),
        ...paidContacts.map((c) => ({
          id: c.id,
          first_name: c.first_name,
          last_name: c.last_name,
          email: c.email,
          phone_number: c.phone_number,
          linkedin_page: c.linkedin_page,
          job_title: c.job_title,
          recommended: c.recommended,
          enrichment: c.enrichment,
          source: "paid" as const,
        })),
      ];

      return {
        lead: {
          id: lead.id,
          name: lead.name,
          score: lead.score,
          ai_agent_lead_score: lead.ai_agent_lead_score,
          location: lead.location,
          description: lead.description,
          short_description: lead.short_description,
          size: lead.size,
          website: lead.website,
          logo: lead.logo,
          ai_summary: lead.ai_summary,
          split_ai_summary: lead.split_ai_summary,
          tags: lead.tags,
          phone_numbers: lead.phone_numbers,
          keywords: lead.keywords,
          contacts_count: lead.contacts_count,
          recommended_contact_title: lead.recommended_contact_title ?? null,
          recommended_contact: lead.recommended_contact ?? null,
          web_fetch_in_progress: lead.web_fetch_in_progress ?? false,
        },
        qualification:
          qualification?.map((q) => ({
            question: q.question,
            score: q.score,
            response: q.response,
            computed_at: q.computed_at,
            outdated_at: q.outdated_at,
          })) ?? null,
        contacts: allContacts,
        web_insights: webFetch?.content ?? null,
        web_insights_fetched_at: webFetch?.fetch_at ?? null,
      };
    },
  });
}
