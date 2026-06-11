import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext } from "../types.js";
import { discoverLeads } from "../tools/discover-leads.js";
import { researchLeadById } from "./research-lead-by-id.js";

import { leadbay_research_lead_by_name_fuzzy as RESEARCH_LEAD_BY_NAME_FUZZY_DESCRIPTION } from "../tool-descriptions.generated.js";

interface ResearchLeadByNameFuzzyParams {
  companyName: string;
  lensId?: number;
  concise?: boolean;
  response_format?: "json" | "markdown";
}

interface DiscoverMatch {
  id: string;
  name: string;
  score: number | null;
}

// Pulled out so tests can exercise the ranking rule directly. Substring,
// case-insensitive, ranked by descending score (null score sorts last).
export function rankSubstringMatches(
  needle: string,
  candidates: Array<{ id: string; name: string; score: number | null }>
): DiscoverMatch[] {
  const n = needle.toLowerCase();
  const hits = candidates.filter((c) =>
    typeof c.name === "string" && c.name.toLowerCase().includes(n)
  );
  hits.sort((a, b) => {
    const aScore = a.score ?? -Infinity;
    const bScore = b.score ?? -Infinity;
    return bScore - aScore;
  });
  return hits;
}

export const researchLeadByNameFuzzy: Tool<ResearchLeadByNameFuzzyParams> = {
  name: "leadbay_research_lead_by_name_fuzzy",
  annotations: {
    title: "Look up a lead by company name (fuzzy)",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: RESEARCH_LEAD_BY_NAME_FUZZY_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      companyName: {
        type: "string",
        description:
          "Company name to look up. Substring fuzzy-match against the full wishlist of the active lens (all pages); ties broken by descending lead score.",
      },
      lensId: {
        type: "number",
        description:
          "Lens id (escape hatch — normally omit; auto-resolves to the active lens)",
      },
      concise: {
        type: "boolean",
        description:
          "Forwarded to leadbay_research_lead_by_id. If true, trims signals to hot=true items only.",
      },
      response_format: {
        type: "string",
        enum: ["json", "markdown"],
        description:
          "Forwarded to leadbay_research_lead_by_id. Default 'json'.",
      },
    },
    required: ["companyName"],
    additionalProperties: false,
  },
  // Output shape matches leadbay_research_lead_by_id; the only additions are
  // _meta.resolved_from / resolved_query / match_candidates which are
  // documented on _by_id's output schema. Defer to _by_id for the schema —
  // duplicating it would just rot.
  outputSchema: {
    type: "object",
    description:
      "Same shape as leadbay_research_lead_by_id, with _meta.resolved_from='companyName', _meta.resolved_query='<needle>', and _meta.match_candidates=[{leadId,name,score}] populated.",
    additionalProperties: true,
  },
  execute: async (
    client: LeadbayClient,
    params: ResearchLeadByNameFuzzyParams,
    ctx?: ToolContext
  ) => {
    if (!params.companyName || typeof params.companyName !== "string") {
      throw client.makeError(
        "INVALID_PARAMS",
        "companyName is required",
        "Pass the company name as a string. If you already have the lead UUID, call leadbay_research_lead_by_id directly."
      );
    }

    const lensId = params.lensId ?? (await client.resolveDefaultLens());

    // Walk the FULL wishlist, not just page 0. The previous implementation
    // only fetched the top 50, so any lead beyond the first page was
    // invisible to the matcher and every such lookup returned
    // LEAD_NOT_FOUND. Page through until has_more is false (capped so a
    // pathological corpus can't run away).
    const allLeads: Array<{ id: string; name: string; score: number | null }> =
      [];
    const MAX_PAGES = 40; // 40 * 50 = 2000 leads, far above any real lens
    let page = 0;
    for (; page < MAX_PAGES; page++) {
      const results = await discoverLeads.execute(
        client,
        { lensId, count: 50, page },
        ctx
      );
      const batch = results.leads as Array<{
        id: string;
        name: string;
        score: number | null;
      }>;
      allLeads.push(...batch);
      if (!results.has_more || batch.length === 0) break;
    }

    const ranked = rankSubstringMatches(params.companyName, allLeads);

    if (ranked.length === 0) {
      const nearestNames = [...allLeads]
        .sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity))
        .slice(0, 5)
        .map((l) => ({ leadId: l.id, name: l.name, score: l.score }));
      throw client.makeError(
        "LEAD_NOT_FOUND",
        `No lead matching "${params.companyName}" in the current lens (searched the full wishlist)`,
        `Call leadbay_pull_leads to see what's available. Top-scoring leads currently in this lens: ${nearestNames
          .map((n) => n.name)
          .join(", ")}.`
      );
    }

    const [primary, ...rest] = ranked;
    const candidates = rest.slice(0, 4).map((m) => ({
      leadId: m.id,
      name: m.name,
      score: m.score,
    }));

    return await researchLeadById.execute(
      client,
      {
        leadId: primary.id,
        lensId,
        concise: params.concise,
        response_format: params.response_format,
        _resolved: {
          from: "companyName",
          query: params.companyName,
          candidates,
        },
      },
      ctx
    );
  },
};
