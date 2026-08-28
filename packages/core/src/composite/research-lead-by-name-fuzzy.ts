import type { LeadbayClient } from "../client.js";
import type {
  LeadbayError,
  ResolvePayload,
  ResolveResult,
  Tool,
  ToolContext,
  WishlistResponse,
} from "../types.js";
import { researchLeadById } from "./research-lead-by-id.js";
import {
  normalizeDomain,
  PUBLIC_MAILBOX_DOMAINS,
} from "./import-leads.js";

import { leadbay_research_lead_by_name_fuzzy as RESEARCH_LEAD_BY_NAME_FUZZY_DESCRIPTION } from "../tool-descriptions.generated.js";

// The registry resolver answers in 100-650 ms in every shape we measured, but
// `client.request` sets no socket deadline by default, so an upstream stall
// would hang the whole tool call indefinitely. Bound it well above the
// observed ceiling and degrade to a normal miss instead.
const RESOLVE_TIMEOUT_MS = 10_000;

// How many ambiguous candidates we hydrate into a user-presentable choice.
// Matches the `_meta.match_candidates` cap the corpus path already uses, and
// keeps the ask_user_input_v0 option list inside its 2-4 label budget.
const MAX_AMBIGUOUS_CANDIDATES = 4;

interface ResearchLeadByNameFuzzyParams {
  companyName: string;
  website?: string;
  email?: string;
  registry_number?: string;
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

function isLeadbayError(error: unknown): error is LeadbayError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as Partial<LeadbayError>).error === true &&
    typeof (error as Partial<LeadbayError>).code === "string" &&
    typeof (error as Partial<LeadbayError>).message === "string" &&
    typeof (error as Partial<LeadbayError>).hint === "string"
  );
}

// The company domain behind a contact email, or null when the mailbox is a
// consumer provider (a gmail.com address says nothing about the company).
// Reuses the list import-leads already maintains rather than starting a
// second one.
export function businessDomainFromEmail(
  email: string | undefined
): string | null {
  if (!email || typeof email !== "string") return null;
  const at = email.lastIndexOf("@");
  if (at === -1) return null;
  const domain = normalizeDomain(email.slice(at + 1));
  if (!domain) return null;
  return PUBLIC_MAILBOX_DOMAINS.has(domain) ? null : domain;
}

// Build the resolver payload. Two rules are load-bearing:
//
//  1. A domain-shaped query goes in `website`, NEVER in `name`. Measured
//     against FR staging 2026-08-28: `{name:"wink-lab.com"}` takes 61.7 s
//     (a hard 60 s backend timeout in the fuzzy name matcher) and still
//     answers `none`, while `{website:"wink-lab.com"}` answers `matched` in
//     133 ms. Same domain, 460x the latency, worse answer.
//  2. Only ResolvePayload fields are sent. The endpoint deserializes
//     strictly — one unknown key returns HTTP 400 for the whole request.
export function buildResolvePayload(params: {
  query: string;
  website?: string;
  email?: string;
  registry_number?: string;
}): ResolvePayload {
  const queryDomain = normalizeDomain(params.query);
  const website =
    (params.website ? normalizeDomain(params.website) : null) ??
    queryDomain ??
    businessDomainFromEmail(params.email);

  const payload: ResolvePayload = {};
  // When the query IS the domain, sending it as `name` too buys nothing and
  // risks the slow path above.
  if (!queryDomain) payload.name = params.query;
  if (website) payload.website = website;
  if (params.email) payload.email = params.email;
  if (params.registry_number) payload.registry_number = params.registry_number;
  return payload;
}

// Does this payload carry an identity assertion strong enough to outrank the
// corpus typeahead? /search/suggest fuzzy-matches names and ignores domains
// entirely, so taking its top hit while holding a domain returns the wrong
// company: on FR staging, companyName:"MAISON" + website:"lesmaisonsdelea.com"
// makes suggest answer MA MAISON BLEUE. The resolver returns ids from the same
// space as suggest (verified: an owned lead resolves to its own lead id), so
// leading with it costs nothing and honours the key the agent supplied.
export function hasStrongIdentityKey(payload: ResolvePayload): boolean {
  return Boolean(payload.website || payload.registry_number);
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
  // The backend applied q across names, domains, and contacts. Preserve its
  // filtered ordering instead of repeating the old name-substring filter,
  // which would discard valid normalized/domain/contact matches.
  return results.items.map((lead) => ({
    id: lead.id,
    name: lead.name,
    score: lead.score,
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

interface AmbiguousCandidate {
  leadId: string;
  name: string | null;
  website: string | null;
  location: string | null;
  registry_ids: Record<string, string> | null;
  score: number;
  matched_on: string[];
  lead_fields_populated: string[];
}

// The resolver returns bare ids, scores and matched_on for ambiguous hits —
// nothing a user could choose between. Hydrate each id into a name + place so
// the agent can put a real question in front of them.
async function hydrateAmbiguous(
  client: LeadbayClient,
  candidates: Extract<ResolveResult, { type: "ambiguous" }>["candidates"],
  lensId: number
): Promise<AmbiguousCandidate[]> {
  const selected = candidates.slice(0, MAX_AMBIGUOUS_CANDIDATES);
  const settled = await Promise.allSettled(
    selected.map((c) =>
      client.request<any>("GET", `/lenses/${lensId}/leads/${c.lead_id}`)
    )
  );
  return selected.map((c, i) => {
    const r = settled[i];
    const lead = r.status === "fulfilled" ? r.value : null;
    return {
      leadId: c.lead_id,
      name: lead?.name ?? null,
      website: lead?.website ?? null,
      location:
        lead?.location?.full ??
        lead?.location?.city ??
        lead?.location?.country ??
        null,
      registry_ids: lead?.registry_ids ?? null,
      score: c.score,
      matched_on: c.matched_on,
      lead_fields_populated: c.lead_fields_populated,
    };
  });
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
          "Company name, domain, or contact name. Resolved against the user's own Discover/Monitor/Activate leads and the Leadbay company registry.",
      },
      website: {
        type: "string",
        description:
          "Company domain or website when you have one (`acme.com`, `https://www.acme.com/` — both fine). This is the single strongest match key; pass it whenever the user mentioned a domain, and a company outside their leads becomes findable.",
      },
      email: {
        type: "string",
        description:
          "A contact email at the company. Used to derive the company domain when `website` is absent; consumer mailboxes (gmail, orange.fr, …) are ignored.",
      },
      registry_number: {
        type: "string",
        description:
          "Company registry number (SIREN/SIRET in France, company number elsewhere). The other exact match key — pass it when the user supplies one, or when a previous LEAD_NOT_FOUND hint asked for it.",
      },
      lensId: {
        type: "number",
        description:
          "Optional strict scope. When supplied, search only this lens's wishlist and do NOT fall through to the registry; normally omit.",
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
  // _meta.resolved_from / resolved_query / resolved_matched_on /
  // match_candidates which are documented on _by_id's output schema. Defer to
  // _by_id for the schema — duplicating it would just rot. The one exception
  // is the ambiguous branch, which returns a disambiguation payload instead
  // of a research card.
  outputSchema: {
    type: "object",
    description:
      "Same shape as leadbay_research_lead_by_id, with _meta.resolved_from='companyName'|'resolver', _meta.resolved_query='<needle>', _meta.resolved_matched_on=[...], and _meta.match_candidates=[{leadId,name,score}] populated. When the registry resolver cannot pick one company, returns {resolution:'ambiguous', query, candidates:[{leadId,name,website,location,registry_ids,score,matched_on}]} instead — ask the user which one, then call leadbay_research_lead_by_id.",
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
        "companyName is required and must be a non-empty string",
        "Pass the company name, domain, or contact name as `companyName` — e.g. companyName:'Wink Lab'. Add `website` (the strongest match key) or `email` when you have one. If you already have the lead UUID, call leadbay_research_lead_by_id with leadId instead."
      );
    }

    const query = params.companyName.trim();
    let lensId = params.lensId;

    // An explicit lensId is a deliberate scope restriction, not a starting
    // point. Search it, and stop there either way.
    if (params.lensId !== undefined) {
      const scoped = await resolveWithinLens(client, query, params.lensId);
      if (scoped.length > 0) {
        return await delegate(scoped, params.lensId);
      }
      throw client.makeError(
        "LEAD_NOT_FOUND",
        `No lead matching "${query}" in lens ${params.lensId}`,
        "This lookup was intentionally restricted to the supplied lens. Omit lensId to search your visible leads across Discover, Monitor, and Activate and then the Leadbay company registry."
      );
    }

    async function delegate(matches: ResolvedMatch[], fallbackLens?: number) {
      const [primary, ...rest] = matches;
      const resolvedLens =
        primary.lensId ?? fallbackLens ?? (await client.resolveDefaultLens());
      return await researchLeadById.execute(
        client,
        {
          leadId: primary.id,
          lensId: resolvedLens,
          concise: params.concise,
          response_format: params.response_format,
          _resolved: {
            from: "companyName",
            query,
            candidates: rest.slice(0, MAX_AMBIGUOUS_CANDIDATES).map((m) => ({
              leadId: m.id,
              name: m.name,
              score: m.score,
            })),
          },
        },
        ctx
      );
    }

    const payload = buildResolvePayload({
      query,
      website: params.website,
      email: params.email,
      registry_number: params.registry_number,
    });

    // Whether /search/suggest actually returned an answer. A transport failure
    // leaves this false, and the miss message must not then claim the user's
    // own leads were searched — that would falsely rule out an owned lead
    // during a search-route outage.
    let corpusSearched = false;
    let ranked: ResolvedMatch[] = [];

    // `strict` distinguishes the two callers below. On the corpus-FIRST path a
    // structured API error is the authoritative answer and stays visible. On
    // the late-fallback path the registry has already given its verdict, so a
    // corpus outage must not mask it.
    const searchCorpus = async (strict: boolean) => {
      try {
        ranked = await resolveAcrossVisibleCorpus(client, query);
        corpusSearched = true;
      } catch (error) {
        if (strict && isLeadbayError(error)) throw error;
        ctx?.logger?.warn?.(
          "Cross-tab company search was unavailable; resolving against the Leadbay registry instead."
        );
      }
    };

    // ── Order of resolution.
    //
    // With no exact key, the corpus typeahead goes first: it is fast
    // (170-270 ms) and it is the right answer for the common case of
    // re-looking-up a lead the user already owns.
    //
    // With a website or registry number in hand, the registry goes first.
    // /search/suggest fuzzy-matches NAMES and ignores the domain entirely, so
    // trusting its top hit would discard the strongest key the agent supplied
    // and can answer with a different company outright (see
    // hasStrongIdentityKey). The resolver shares suggest's id space, so an
    // owned lead still resolves to its own id and still renders as its own
    // research card.
    const registryFirst = hasStrongIdentityKey(payload);
    if (!registryFirst) {
      await searchCorpus(true);
      if (ranked.length > 0) return await delegate(ranked);
    }

    // ── The Leadbay company registry. This is what makes a company the user
    // does not own yet findable at all.
    let resolved: ResolveResult;
    try {
      resolved = await client.request<ResolveResult>(
        "POST",
        "/leads/resolve",
        payload,
        { timeoutMs: RESOLVE_TIMEOUT_MS }
      );
    } catch (error) {
      if (isLeadbayError(error)) throw error;
      throw client.makeError(
        "LEAD_NOT_FOUND",
        `Could not reach the Leadbay company registry while looking up "${query}"`,
        "The registry lookup did not complete. Retry once; if it fails again, say so rather than concluding the company is missing.",
        "POST /leads/resolve"
      );
    }

    if (resolved.type === "matched") {
      lensId = lensId ?? (await client.resolveDefaultLens());
      return await researchLeadById.execute(
        client,
        {
          leadId: resolved.lead_id,
          lensId,
          concise: params.concise,
          response_format: params.response_format,
          _resolved: {
            from: "resolver",
            query,
            candidates: [],
            matched_on: resolved.matched_on,
          },
        },
        ctx
      );
    }

    if (resolved.type === "ambiguous" && resolved.candidates.length > 0) {
      const hydrationLens = lensId ?? (await client.resolveDefaultLens());
      const candidates = await hydrateAmbiguous(
        client,
        resolved.candidates,
        hydrationLens
      );
      return {
        resolution: "ambiguous" as const,
        query,
        resolver_payload: payload,
        candidates,
        next_step:
          "Ask the user which company they mean, then call leadbay_research_lead_by_id with the chosen leadId. Do not guess from score — it is a tied evidence band, not a confidence.",
        _meta: {
          region: client.region,
          lens_id: hydrationLens,
          resolved_from: "resolver" as const,
          resolved_query: query,
        },
      };
    }

    // The registry has no answer. If we led with it because a domain was
    // supplied, the user's own leads have not been looked at yet — a lead they
    // own whose record carries no website would be invisible to the resolver
    // but findable by name. Check before declaring a miss.
    if (!corpusSearched) {
      await searchCorpus(false);
      if (ranked.length > 0) return await delegate(ranked);
    }

    // `none` and `unidentifiable` are both genuine misses, but they fail for
    // different reasons and the resolver says which. Carry its own vocabulary
    // into the hint so the agent asks for the missing field instead of
    // declaring the company absent. Never claim a search that did not run.
    const registryScope = payload.website
      ? `the Leadbay company registry (domain ${payload.website})`
      : "the Leadbay company registry";
    const searched = corpusSearched
      ? `in your visible Leadbay leads and in ${registryScope}`
      : `in ${registryScope} — your own leads could NOT be searched, the search route was unreachable`;
    const wanted =
      resolved.type === "none" && resolved.would_help.length > 0
        ? resolved.would_help
        : ["website", "registry_number"];
    const asks = wanted
      .map((f) =>
        f === "registry_number"
          ? "a registry number (SIREN/SIRET) for `registry_number`"
          : f === "website"
            ? "the company website for `website`"
            : `\`${f}\``
      )
      .join(" or ");
    const hint =
      resolved.type === "unidentifiable"
        ? `The registry could not identify a company from this input (${resolved.reason}). Ask the user for ${asks}, then call this tool again with it.`
        : `The registry found no company for what was supplied. It would match on ${asks}. Ask the user for that — "what's their website?" usually settles it — then call this tool again. Do not offer an import before asking.`;

    throw client.makeError(
      "LEAD_NOT_FOUND",
      `No company matching "${query}" ${searched}`,
      hint,
      "POST /leads/resolve"
    );
  },
};
