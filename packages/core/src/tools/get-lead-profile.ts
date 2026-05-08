import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";
import type {
  LeadPayload,
  AiAgentResponse,
  ContactPayload,
  PaidContactPayload,
  LeadWebFetchPayload,
} from "../types.js";

interface GetLeadProfileParams {
  leadId: string;
  lensId?: number;
}

export const getLeadProfile: Tool<GetLeadProfileParams> = {
  name: "leadbay_get_lead_profile",
  annotations: {
    title: "Read a lead profile",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description:
    "Get a full lead profile including company details, AI qualification scores, web insights, and contacts. " +
    "When to use: low-level — for fine-grained access to the raw shape of the lead profile. " +
    "When NOT to use: as the agent's default lead-detail tool — use leadbay_research_lead, which structures " +
    "the data top-down (qualification first, then signals, then firmographics, then contacts, then engagement) " +
    "and reshapes web_fetch.content into a stable array form.",
  inputSchema: {
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
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      lead: {
        type: "object",
        description:
          "Lead basics: id, name, score, ai_agent_lead_score, location, description, short_description, size, website, logo, ai_summary, split_ai_summary, tags, phone_numbers, keywords, contacts_count, recommended_contact_title, recommended_contact, web_fetch_in_progress.",
      },
      qualification: {
        type: ["array", "null"],
        description:
          "Per-question AI qualification answers ({question, score, response, computed_at, outdated_at}), or null if none.",
        items: { type: "object" },
      },
      contacts: {
        type: "array",
        description:
          "Merged org+paid contacts. Each: {id, first_name, last_name, email, phone_number, linkedin_page, job_title, recommended, enrichment, source:'org'|'paid'}.",
        items: { type: "object" },
      },
      web_insights: { description: "Latest /web_fetch content (string) or null." },
      web_insights_fetched_at: { description: "ISO timestamp of /web_fetch (string) or null." },
    },
    required: ["lead", "contacts"],
  },
  execute: async (client: LeadbayClient, params: GetLeadProfileParams) => {
    const lensId = params.lensId ?? (await client.resolveDefaultLens());

    // Mark the lead as seen+clicked in the user's lens so it ages out of
    // the 'new' Discover view and the lens refresh pipeline can deliver
    // fresh leads tomorrow. Fire-and-forget: a failure here must NOT
    // break the profile fetch.
    void client.request<void>("POST", "/interactions", [
      { type: "LEAD_SEEN",    leadId: params.leadId, lensId: String(lensId) },
      { type: "LEAD_CLICKED", leadId: params.leadId, lensId: String(lensId) },
    ]).catch(() => { /* swallow — interaction logging is best-effort */ });

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

    // Merge org contacts and paid contacts
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
};
