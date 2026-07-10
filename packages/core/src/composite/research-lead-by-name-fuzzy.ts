import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext, WishlistResponse } from "../types.js";
import { researchLeadById } from "./research-lead-by-id.js";

import { leadbay_research_lead_by_name_fuzzy as RESEARCH_LEAD_BY_NAME_FUZZY_DESCRIPTION } from "../tool-descriptions.generated.js";

interface ResearchLeadByNameFuzzyParams {
  companyName: string;
  lensId?: number;
  concise?: boolean;
  response_format?: "json" | "markdown";
}

interface ResolvedMatch {
  id: string;
  name: string;
  score: number | null;
  lensId?: number;
}

interface SearchSuggestion {
  text: string;
  match_type?: "COMPANY" | "DOMAIN" | "PERSON";
  matchType?: "COMPANY" | "DOMAIN" | "PERSON";
  company_name?: string | null;
  companyName?: string | null;
  lead_id?: string;
  leadId?: string;
  in_discover?: boolean;
  inDiscover?: boolean;
  in_monitor?: boolean;
  inMonitor?: boolean;
  in_activate?: boolean;
  inActivate?: boolean;
  // The backend uses LongAsStringSerializer for this field.
  lens_id?: string | number | null;
  lensId?: string | number | null;
}

// Pulled out so tests can exercise the ranking rule directly. Substring,
// case-insensitive, ranked by descending score (null score sorts last).
export function rankSubstringMatches(
  needle: string,
  candidates: Array<{ id: string; name: string; score: number | null }>
): ResolvedMatch[] {
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

function parseLensId(value: unknown): number | undefined {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function suggestionName(suggestion: SearchSuggestion): string {
  const companyName = (
    suggestion.company_name ?? suggestion.companyName
  )?.trim();
  return companyName || suggestion.text.trim();
}

function suggestionLeadId(suggestion: SearchSuggestion): string | undefined {
  return suggestion.lead_id ?? suggestion.leadId;
}

function isLeadbayError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { code?: unknown }).code === "string"
  );
}

async function resolveWithinLens(
  client: LeadbayClient,
  query: string,
  lensId: number
): Promise<ResolvedMatch[]> {
  const results = await client.request<WishlistResponse>(
    "GET",
    `/lenses/${lensId}/leads/wishlist?q=${encodeURIComponent(query)}&count=50&page=0&contacts=false`
  );
  const allLeads = results.items.map((lead) => ({
    id: lead.id,
    name: lead.name,
    score: lead.score,
    lensId,
  }));
  return rankSubstringMatches(query, allLeads).map((match) => ({
    ...match,
    lensId,
  }));
}

async function resolveAcrossVisibleCorpus(
  client: LeadbayClient,
  query: string
): Promise<ResolvedMatch[]> {
  const suggestions = await client.request<SearchSuggestion[]>(
    "GET",
    `/search/suggest?q=${encodeURIComponent(query)}`
  );
  return suggestions
    .map((suggestion) => {
      const id = suggestionLeadId(suggestion);
      return {
        id: id ?? "",
        name: suggestionName(suggestion),
        score: null,
        lensId: parseLensId(suggestion.lens_id ?? suggestion.lensId),
      };
    })
    .filter((suggestion) => suggestion.id !== "" && suggestion.name !== "");
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
          "Company name, domain, or contact name to resolve across visible Leadbay leads in Discover, Monitor, and Activate.",
      },
      lensId: {
        type: "number",
        description:
          "Optional strict scope. When supplied, search only this lens's wishlist; normally omit to search all visible Leadbay leads.",
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
    if (
      !params.companyName ||
      typeof params.companyName !== "string" ||
      params.companyName.trim() === ""
    ) {
      throw client.makeError(
        "INVALID_PARAMS",
        "companyName is required",
        "Pass the company name as a string. If you already have the lead UUID, call leadbay_research_lead_by_id directly."
      );
    }

    const query = params.companyName.trim();
    let ranked: ResolvedMatch[];
    let lensId = params.lensId;

    if (lensId !== undefined) {
      ranked = await resolveWithinLens(client, query, lensId);
    } else {
      try {
        ranked = await resolveAcrossVisibleCorpus(client, query);
      } catch (error) {
        // A structured API response is authoritative and should remain visible.
        // Only a transport/parser failure gets the legacy active-lens fallback.
        // This keeps lookups usable during a search-route connectivity incident
        // without silently treating the lens as the normal search universe.
        if (isLeadbayError(error)) throw error;
        lensId = await client.resolveDefaultLens();
        ctx?.logger?.warn?.(
          "Cross-tab company search was unavailable; falling back to the active lens for this lookup."
        );
        ranked = await resolveWithinLens(client, query, lensId);
      }
    }

    if (ranked.length === 0) {
      const scope = params.lensId === undefined
        ? "across your visible Leadbay leads"
        : `in lens ${params.lensId}`;
      const hint = params.lensId === undefined
        ? "Search checks company names, domains, and contact names across Discover, Monitor, and Activate. Confirm the spelling or domain, or add/import the company first."
        : "This lookup was intentionally restricted to the supplied lens. Omit lensId to search visible leads across Discover, Monitor, and Activate.";
      throw client.makeError(
        "LEAD_NOT_FOUND",
        `No lead matching "${query}" ${scope}`,
        hint
      );
    }

    const [primary, ...rest] = ranked;
    lensId = primary.lensId ?? lensId ?? (await client.resolveDefaultLens());
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
          query,
          candidates,
        },
      },
      ctx
    );
  },
};
