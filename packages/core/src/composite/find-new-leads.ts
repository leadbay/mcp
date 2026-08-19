// leadbay_find_new_leads — POST /mcp/search + poll GET /mcp/jobs/{id}
//
// One ask -> n net-new companies matching an ICP, optionally AI-qualified
// against the org's frozen intelligence snapshot, optionally with the right
// contact + purchased channels. Free by default (qualify:false, channels:[]).
// Submit validates synchronously (<1s, every input error is a 400 naming the
// field); results stream per-item and are collected here with a short poll
// window, handing back a job_id + leadbay_lead_job_status when the job
// outlives the window.
import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext } from "../types.js";
import {
  clampWaitSeconds,
  collectJobSnapshot,
  canonicalSet,
  coerceArrayParams,
  canonicalIdSet,
  canonicalLabelSet,
  canonicalOptionalObject,
  derivedKey,
  presentRequestId,
  mockedSubmitPreview,
  compactBody,
  normalizeSearchFilters,
  rejectCountryLocations,
  rejectMalformedExclusions,
  rejectOversizedExclusions,
  splitItems,
  TERMINAL_JOB_STATES,
  waitForJob,
  type McpDryRunResponse,
  type McpSubmitResponse,
} from "./_mcp-job-helpers.js";
import { leadbay_find_new_leads as FIND_NEW_LEADS_DESCRIPTION } from "../tool-descriptions.generated.js";

interface FindNewLeadsParams {
  query?: string;
  example_lead?: {
    name?: string;
    description?: string;
    location?: string;
    employees?: number;
  };
  filters?: {
    sectors?: string[];
    locations?: string[];
    employees_min?: number;
    employees_max?: number;
  };
  count: number;
  qualify?: boolean;
  min_ai_score?: number;
  contact_titles?: string[];
  title_gate?: "strict" | "prefer";
  channels?: Array<"email" | "phone">;
  exclude_lead_ids?: string[];
  novelty?: "org" | "none";
  max_cost?: number;
  exploration_cap?: number;
  request_id: string;
  lang?: string;
  confirm?: boolean;
  dry_run?: boolean;
  wait_seconds?: number;
}

const DEFAULT_WAIT_SECONDS = 45;

/** Canonicalize the filter lists that are unordered SETS of free-text labels
 *  to the backend, so a retry listing the same sectors/locations in another
 *  order — or with different casing — still derives the same idempotency key.
 *  Object key order is handled by canonicalize() inside derivedKey; empty
 *  shapes are collapsed by canonicalOptionalObject at the call site. */
function sortFilterLists(
  filters: Record<string, unknown> | undefined
): Record<string, unknown> | null {
  if (!filters) return null;
  const out: Record<string, unknown> = { ...filters };
  for (const key of ["sectors", "locations"]) {
    if (Array.isArray(out[key])) {
      out[key] = canonicalLabelSet(out[key] as string[]);
    }
  }
  return out;
}

export const findNewLeads: Tool<FindNewLeadsParams, any> = {
  name: "leadbay_find_new_leads",
  annotations: {
    title: "Find new leads (net-new ICP search)",
    readOnlyHint: false,
    // The tool CAN bill (qualify:true and/or channels) and records deliveries
    // in the org novelty ledger, so it advertises destructive like the other
    // paid composites — annotations are static and must describe the worst
    // case, not the default. The free path is protected in execute() instead:
    // a paid call is withheld until `confirm: true`.
    destructiveHint: true,
    // The mandatory request_id dedups: re-submitting the same request returns
    // the SAME live job instead of double-spending.
    idempotentHint: true,
    openWorldHint: true,
  },
  write: true,
  description: FIND_NEW_LEADS_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Natural-language ICP ask. Matches topic VOCABULARY — can surface vendors of a product as easily as buyers of it. Prefer example_lead; use query only when the user's wording carries signal an example can't.",
      },
      example_lead: {
        type: "object",
        description:
          "A FICTIONAL typical ideal customer used as a look-alike seed — the highest-leverage input. Put everything in `description` (registry 'About Us' style, what the company IS); leave `name` unset (a distinctive invented name pulls matches toward name-lookalikes).",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          location: { type: "string" },
          employees: { type: "number" },
        },
        additionalProperties: false,
      },
      filters: {
        type: "object",
        description:
          "HARD constraints (the seed only shapes ranking). Sector/location labels resolve at submit; an unresolvable value is a 400 naming it.",
        properties: {
          sectors: { type: "array", items: { type: "string" } },
          locations: { type: "array", items: { type: "string" } },
          employees_min: { type: "number" },
          employees_max: { type: "number" },
        },
        additionalProperties: false,
      },
      count: {
        type: "number",
        description:
          "Target DELIVERED leads, 1-50. With qualify:true this means n SURVIVORS of qualification, not n candidates examined.",
      },
      qualify: {
        type: "boolean",
        description:
          "Run fresh AI qualification and drop candidates scoring below min_ai_score. PAID: ~94 cost_cents per candidate EXAMINED (survivor or not). Default false (free).",
      },
      min_ai_score: {
        type: "number",
        description:
          "Disqualification floor on the [-30,+30] qualification DELTA (not the 0-100 fit score). Default 0. Lower to -30 to keep every evaluated lead with its evidence.",
      },
      contact_titles: {
        type: "array",
        items: { type: "string" },
        description:
          "Wanted decision-maker titles (max 10), matched semantically cross-language.",
      },
      title_gate: {
        type: "string",
        enum: ["strict", "prefer"],
        description:
          "strict = only leads with a matching known contact; prefer (default when contact_titles set) = matched first, rest flagged.",
      },
      channels: {
        type: "array",
        items: { type: "string", enum: ["email", "phone"] },
        description:
          "Contact channels to PURCHASE (email 25c, phone 250c, billed on success only). Empty = free identity tier.",
      },
      exclude_lead_ids: {
        type: "array",
        items: { type: "string" },
        description:
          "Caller-side novelty belt on top of the server-side one (max 500 ids — over that the call is refused, so drop the DELIVERED ids first: novelty:'org' already covers those, and the examined-but-rejected ones are what it misses).",
      },
      novelty: {
        type: "string",
        enum: ["org", "none"],
        description:
          "org (default) = only companies NEW to the org (excludes org leads, lens members, CRM ids, prior MCP deliveries).",
      },
      max_cost: {
        type: "number",
        description:
          "Spend cap for the whole job in cost_cents. Defaults by plan tier (500/2000/5000). The job stops honestly at the cap (stop_reason max_cost).",
      },
      exploration_cap: {
        type: "number",
        description:
          "Max candidates the qualify gate may examine. Default min(3n,150), ceiling min(20n,1000).",
      },
      request_id: {
        type: "string",
        description:
          "REQUIRED idempotency key. Derive it from the ask (e.g. 'gyms-texas-2026-07-28'); REUSE the exact same value when retrying the same ask — a duplicate returns the SAME job instead of double-spending. Use a NEW value only for a genuinely new ask.",
      },
      lang: { type: "string", description: "Output language (default: user's language)." },
      confirm: {
        type: "boolean",
        description:
          "Explicit spend decision, required only for a PAID search (qualify:true and/or channels). true = the user approved the quote, go ahead. false = a veto (returns mode:'needs_confirmation', spends nothing). Omitted on a paid call → the tool withholds the submit and returns a free quote to show the user first. The default FREE search (no qualify, no channels) needs no confirm.",
      },
      dry_run: {
        type: "boolean",
        description:
          "Validate + worst-case cost estimate + quota forecast. No job, no spend. Use before the first PAID run of a session.",
      },
      wait_seconds: {
        type: "number",
        description:
          "How long to poll before returning (default 45, max 180, 0 = submit + one snapshot). Free searches usually finish inside the window; paid exploration can take minutes — the result then carries still_running:true and the job_id to check with leadbay_lead_job_status.",
      },
    },
    required: ["count", "request_id"],
    additionalProperties: false,
  },
  execute: async (
    client: LeadbayClient,
    params: FindNewLeadsParams,
    ctx?: ToolContext
  ) => {
    // Unvalidated MCP args can arrive singular; coerce BEFORE the spend gate
    // so a shape slip is never a TypeError in place of a quote.
    params = coerceArrayParams(params, [
      "contact_titles",
      "channels",
      "exclude_lead_ids",
    ]);
    rejectCountryLocations(params.filters?.locations, client.region);
    // Types first, then the cap: counting a list that still contains junk
    // would size the cap against entries that were never going to be sent.
    rejectMalformedExclusions(params.exclude_lead_ids);
    rejectOversizedExclusions(params.exclude_lead_ids);

    // Same spend gate as leadbay_qualify_leads. The trigger differs: `qualify`
    // defaults to FALSE here, so the default ask really is free and only an
    // explicit qualify:true and/or requested channels costs money. When it
    // does, the submit is withheld pending `confirm: true` and a real
    // dry-run quote is returned instead.
    const buysChannels = (params.channels?.length ?? 0) > 0;
    const buysQualification = params.qualify === true;
    const isPaid = buysQualification || buysChannels;
    const vetoed = params.confirm === false;
    const consented = !vetoed && params.confirm === true;

    // `request_id` is schema-`required`, but the server does not validate
    // schemas before dispatch, so a caller can omit it and compactBody would
    // drop the key entirely — leaving a confirmed PAID search with no
    // idempotency handle, so a timeout + retry launches a second paid,
    // novelty-claiming job. Synthesize a stable key from the approved search
    // itself, exactly as the qualify path does.
    const requestId =
      presentRequestId(params.request_id) ??
      derivedKey(
        "search-auto",
        // Passed as an OBJECT: derivedKey canonicalizes recursively, so nested
        // property order (example_lead, filters) can never fork the key. Fields
        // with a documented backend default are canonicalized TO that default,
        // so an approval that omits one and a retry that passes it explicitly
        // derive the same key rather than launching a second paid,
        // novelty-claiming job.
        {
          query: params.query ?? null,
          example_lead: params.example_lead ?? null,
          // Sector/location lists are unordered sets to the backend — sort
          // them so a reordered retry still dedupes.
          filters: canonicalOptionalObject(sortFilterLists(normalizeSearchFilters(params.filters))),
          count: params.count ?? null,
          qualify: params.qualify === true,
          min_ai_score: params.min_ai_score ?? 0,
          contact_titles: canonicalLabelSet(params.contact_titles),
          title_gate:
            params.title_gate ??
            ((params.contact_titles?.length ?? 0) > 0 ? "prefer" : null),
          channels: canonicalSet(params.channels),
          // Sorted so ordering alone never forks the key, but PRESENT — a
          // top-up differing only by exclude_lead_ids is a different approved
          // search, and hashing it the same would return the first job as a
          // duplicate with the exclusions never applied.
          exclude_lead_ids: canonicalIdSet(params.exclude_lead_ids),
          novelty: params.novelty ?? "org",
          max_cost: params.max_cost ?? null,
          // Documented backend default is min(3n,150), so an omitted cap is
          // canonicalized TO it — same principle as min_ai_score/novelty above.
          // Otherwise an approval that omits the cap and a retry that passes the
          // materialized default ask for identical work under different keys,
          // and the retry escapes dedupe into a second paid, novelty-claiming
          // job. An explicit non-default cap still hashes distinctly.
          exploration_cap:
            params.exploration_cap ??
            (typeof params.count === "number" && params.count > 0
              ? Math.min(3 * params.count, 150)
              : null),
          lang: params.lang ?? null,
        }
      );

    const body = compactBody({
      query: params.query,
      example_lead: params.example_lead,
      filters: normalizeSearchFilters(params.filters),
      count: params.count,
      qualify: params.qualify,
      min_ai_score: params.min_ai_score,
      contact_titles: params.contact_titles,
      title_gate: params.title_gate,
      channels: params.channels,
      // Wire the SAME list the cap guard counted and the idempotency key was
      // derived from. Posting the raw array instead let a 600-entry list that
      // dedupes to 400 clear the guard and still be refused by the backend.
      // Kept undefined when absent so compactBody drops it rather than
      // sending an empty array.
      exclude_lead_ids: params.exclude_lead_ids
        ? canonicalIdSet(params.exclude_lead_ids)
        : undefined,
      novelty: params.novelty,
      max_cost: params.max_cost,
      exploration_cap: params.exploration_cap,
      request_id: requestId,
      lang: params.lang,
      dry_run: params.dry_run,
    });

    if (params.dry_run) {
      const forecast = await client.request<McpDryRunResponse>(
        "POST",
        "/mcp/search",
        body
      );
      return {
        dry_run: true,
        ...forecast,
        region: client.region,
      };
    }

    if (isPaid && !consented) {
      const forecast = vetoed
        ? null
        : await client.request<McpDryRunResponse>("POST", "/mcp/search", {
            ...body,
            dry_run: true,
          });
      return {
        mode: "needs_confirmation",
        submitted: false,
        vetoed,
        paid_because: [
          buysQualification
            ? "qualify: true (~94 cost_cents per candidate EXAMINED)"
            : null,
          buysChannels ? `channels requested: ${params.channels!.join(", ")}` : null,
        ].filter(Boolean),
        quote: forecast,
        estimated_cost: forecast?.estimated_cost ?? null,
        items_requested: forecast?.items_requested ?? null,
        hint: vetoed
          ? "confirm:false vetoed the spend — nothing was submitted. Re-call with confirm:true to proceed, or drop qualify/channels for a free search."
          : "Show the user this worst-case quote and get an explicit go-ahead, then re-call with confirm:true. For a free search instead: omit qualify and channels.",
        region: client.region,
      };
    }

    const submit = await client.request<McpSubmitResponse>(
      "POST",
      "/mcp/search",
      body
    );
    const mocked = mockedSubmitPreview(
      submit,
      "leadbay_find_new_leads",
      client.region
    );
    if (mocked) return mocked;
    const waitSeconds = clampWaitSeconds(
      params.wait_seconds,
      DEFAULT_WAIT_SECONDS
    );
    const snapshot =
      waitSeconds > 0
        ? await waitForJob(client, submit.job_id, waitSeconds, ctx, params.count)
        : await collectJobSnapshot(
            client,
            submit.job_id,
            undefined,
            undefined,
            ctx?.signal
          );

    const done = TERMINAL_JOB_STATES.has(snapshot.job.state);
    const { leads, skipped } = splitItems(snapshot);
    return {
      job_id: submit.job_id,
      request_id: requestId,
      duplicate_submit: submit.duplicate ?? false,
      state: snapshot.job.state,
      done,
      summary: {
        // Named items_requested (not `requested`) to match qualify_leads and
        // the shared renderer, which reads summary.items_requested for the
        // "delivered X of the Y asked" clause.
        items_requested: submit.items_requested ?? params.count,
        delivered: snapshot.funnel.delivered ?? 0,
        delivered_callable: snapshot.funnel.delivered_callable ?? 0,
        delivered_title_only: snapshot.funnel.delivered_title_only ?? 0,
        degraded: snapshot.funnel.degraded ?? 0,
        stop_reason: snapshot.funnel.stop_reason ?? null,
      },
      funnel: snapshot.funnel,
      leads,
      skipped,
      cost: snapshot.cost,
      estimated_cost: submit.estimated_cost,
      explain: snapshot.explain,
      still_running: !done,
      next_poll: done
        ? null
        : {
            tool: "leadbay_lead_job_status",
            job_id: submit.job_id,
            // Hand the cursor forward so the follow-up poll continues
            // INCREMENTALLY instead of re-reading (and re-rendering) the
            // rows already delivered in this response.
            since: snapshot.next_since ?? null,
            suggested_wait_seconds: 60,
          },
      region: client.region,
    };
  },
};
