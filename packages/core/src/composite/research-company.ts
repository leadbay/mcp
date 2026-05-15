import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext } from "../types.js";
import { discoverLeads } from "../tools/discover-leads.js";
import { getLeadProfile } from "../tools/get-lead-profile.js";
import { getLeadActivities } from "../tools/get-lead-activities.js";

import { leadbay_research_company as RESEARCH_COMPANY_DESCRIPTION } from "../tool-descriptions.generated.js";
interface ResearchCompanyParams {
  companyName?: string;
  leadId?: string;
}

export const researchCompany: Tool<ResearchCompanyParams> = {
  name: "leadbay_research_company",
  annotations: {
    title: "Research a company by name",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: RESEARCH_COMPANY_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      companyName: {
        type: "string",
        description:
          "Company name to research (one of companyName or leadId required). Matches the top-scoring lead with this name.",
      },
      leadId: {
        type: "string",
        description:
          "Lead UUID if already known (one of companyName or leadId required). Takes precedence over companyName.",
      },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      lead: {
        type: "object",
        description:
          "Lead profile basics (id, name, score, ai_agent_lead_score, location, description, short_description, size, website, logo, ai_summary, tags, phone_numbers, keywords, contacts_count, recommended_contact_title, recommended_contact, web_fetch_in_progress).",
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
          "Merged org + paid contacts. Each: {id, first_name, last_name, email, phone_number, linkedin_page, job_title, recommended, enrichment, source:'org'|'paid'}.",
        items: { type: "object" },
      },
      web_insights: {
        description: "Latest /web_fetch content (string) or null when no fetch is available.",
      },
      web_insights_fetched_at: {
        description: "ISO timestamp of the latest /web_fetch (string) or null.",
      },
      recent_activities: {
        type: "array",
        description:
          "Recent activities for this lead (top 20). Each is the activity payload as returned by /leads/{id}/activities.",
        items: { type: "object" },
      },
    },
    required: ["lead", "contacts", "recent_activities"],
  },
  execute: async (
    client: LeadbayClient,
    params: ResearchCompanyParams,
    ctx?: ToolContext
  ) => {
    if (!params.leadId && !params.companyName) {
      throw client.makeError(
        "INVALID_PARAMS",
        "Pass either leadId or companyName",
        "Call leadbay_pull_leads first to surface candidate leads with their IDs, then call this with leadId."
      );
    }

    let leadId = params.leadId;

    if (!leadId && params.companyName) {
      // Try to match by scanning the first page of the active lens
      const results = await discoverLeads.execute(
        client,
        { count: 50, page: 0 },
        ctx
      );
      const needle = params.companyName.toLowerCase();
      const match = (results.leads as Array<{ id: string; name: string }>).find(
        (l) => l.name.toLowerCase().includes(needle)
      );
      if (!match) {
        throw client.makeError(
          "LEAD_NOT_FOUND",
          `No lead matching "${params.companyName}" in the current lens`,
          "Call leadbay_pull_leads (optionally with a broader lensId) to see what's available, then call this with leadId."
        );
      }
      leadId = match.id;
    }

    const [profile, activities] = await Promise.allSettled([
      getLeadProfile.execute(client, { leadId: leadId! }, ctx),
      getLeadActivities.execute(client, { leadId: leadId!, count: 20 }, ctx),
    ]);

    if (profile.status === "rejected") {
      throw profile.reason;
    }

    return {
      ...profile.value,
      recent_activities:
        activities.status === "fulfilled" ? activities.value.activities : [],
    };
  },
};
