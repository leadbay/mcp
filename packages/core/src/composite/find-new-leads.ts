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
  readSpendFlag,
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
  snapshotAfterSubmit,
  splitItems,
  TERMINAL_JOB_STATES,
  waitForJob,
  type McpDryRunResponse,
  type McpSubmitResponse,
} from "./_mcp-job-helpers.js";
import { detectCountryLocations } from "./_country-guard.js";
import {
  fetchSectorTaxonomy,
  resolveSectorValues,
  type SectorResolution,
} from "./_sector-resolver.js";
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

/** The API answers an unknown sector label with a `bad_request` naming the
 *  field, which the client files as BAD_INPUT. Matching on the field name and
 *  not on the rest of the sentence keeps the recovery narrow: if the wording
 *  ever changes, the call falls back to today's 400 rather than to something
 *  worse. */
function isSectorRejection(err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown } | null;
  return (
    !!e &&
    e.code === "BAD_INPUT" &&
    typeof e.message === "string" &&
    e.message.includes("filters.sectors")
  );
}

type SearchAttempt<T> =
  | { ok: true; data: T; rewritten: Array<{ asked: string; used: string }> }
  | { ok: false; choice: Record<string, unknown> };

/**
 * POST /mcp/search, and when the only thing wrong with the call is how a sector
 * was spelled, fix it and send it again.
 *
 * The API matches `filters.sectors` as an exact label, so a scheduled agent
 * writing "Professional Services" burns a failed call at the top of every run
 * and never learns from the refusal, because it re-reads the tool description
 * each time (product#4140). A word the taxonomy has no label for is answered
 * with the labels to choose from, so the caller is never left with a 400 that
 * tells it not to retry and gives it nothing to retry WITH.
 */
async function submitSearch<T>(
  client: LeadbayClient,
  body: Record<string, unknown>,
  opts: { preSendSignal?: AbortSignal } | undefined,
  ctx: ToolContext | undefined
): Promise<SearchAttempt<T>> {
  try {
    return {
      ok: true,
      data: await client.request<T>("POST", "/mcp/search", body, opts),
      rewritten: [],
    };
  } catch (err) {
    const asked = (body.filters as { sectors?: unknown } | undefined)?.sectors;
    if (!isSectorRejection(err) || !Array.isArray(asked) || asked.length === 0) {
      throw err;
    }
    // The API names only the FIRST value it could not resolve, so re-read all
    // of them: fixing one at a time would spend a call per bad sector.
    const taxonomy = await fetchSectorTaxonomy(client, ctx);
    const fix = resolveSectorValues(asked as string[], taxonomy);
    // Nothing here can name a better value — a taxonomy id that does not exist
    // is the caller's own to correct, and answering it with an empty list of
    // sectors to choose from would be an answer with nothing in it.
    if (fix.unresolved.length === 0 && fix.rewritten.length === 0) throw err;
    if (fix.unresolved.length > 0) return { ok: false, choice: sectorChoice(fix) };
    // One retry is the whole budget. The labels come from the taxonomy itself,
    // so a second refusal is not something a third spelling would fix.
    const retried = { ...body, filters: { ...(body.filters as object), sectors: fix.values } };
    return {
      ok: true,
      data: await client.request<T>("POST", "/mcp/search", retried, opts),
      rewritten: fix.rewritten,
    };
  }
}

/** A rewritten sector is still a hard fence on the search, so the answer says
 *  which label actually ran. Its own key, not `note`: the country guard already
 *  owns `note` and the two can fire on the same call. */
function sectorNote(
  rewritten: Array<{ asked: string; used: string }>
): { sectors_note: string; sectors_used: Array<{ asked: string; used: string }> } | undefined {
  if (rewritten.length === 0) return undefined;
  const pairs = rewritten.map((r) => `"${r.asked}" → "${r.used}"`).join(", ");
  return {
    sectors_note: `Leadbay's sector taxonomy spells these differently, so the search ran on ${pairs}. Tell the user which sector was searched.`,
    sectors_used: rewritten,
  };
}

/** Nothing was submitted and nothing was spent. The caller gets the exact
 *  labels the API will accept — the closest ones first, then the registry's
 *  top-level sections, which is where a word like "Professional Services" that
 *  is in no label at all still has somewhere correct to land. */
function sectorChoice(fix: SectorResolution): Record<string, unknown> {
  const names = fix.unresolved.map((u) => `"${u.asked}"`).join(", ");
  return {
    mode: "needs_sector_choice",
    submitted: false,
    unresolved_sectors: fix.unresolved.map((u) => ({
      asked: u.asked,
      closest: u.closest.map((c) => c.name),
    })),
    sector_sections: fix.sections,
    resolved_sectors: fix.rewritten,
    hint:
      `No sector in this workspace's taxonomy is named ${names || "that"}. ` +
      "Nothing was submitted and nothing was spent. Re-call with a label copied " +
      "character for character from `closest` or `sector_sections` (a section " +
      "covers everything under it), or drop `filters.sectors` and put the wording " +
      "in `query` / `example_lead.description` instead — the search then RANKS on " +
      "it rather than fencing on it, which is usually what the user meant. " +
      "`leadbay_list_sectors` returns the full taxonomy if none of these fit.",
  };
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
          "HARD constraints (the seed only shapes ranking). Sector/location labels resolve at submit. `sectors` must be a label from Leadbay's own taxonomy (leadbay_list_sectors) — everyday wording like 'Professional Services' is not one; a spelling/plural slip is corrected for you, but a word with no label comes back as mode:'needs_sector_choice' with the labels to pick from. An unresolvable location is a 400 naming it.",
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
          "Run fresh AI qualification and drop candidates scoring below min_ai_score. Uses the org's usage quota for every candidate EXAMINED (survivor or not). Default false (free).",
      },
      min_ai_score: {
        type: "number",
        minimum: -30,
        maximum: 30,
        description:
          "Disqualification floor on the [-30,+30] qualification DELTA (not the 0-100 fit score). Default 0. Lower to -30 to keep every evaluated lead with its evidence.",
      },
      contact_titles: {
        type: "array",
        items: { type: "string" },
        maxItems: 10,
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
          "Contact channels to find (email, phone). Uses the org's usage quota only when a value is found. Empty = free identity tier.",
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
          "Usage cap for the whole job, in internal units. Leave it unset: the default (100000) covers any job. What the requested channels need is kept for them; a cap below that is refused, naming the minimum. Never show it to the user as money.",
      },
      exploration_cap: {
        type: "number",
        description:
          "Max candidates the qualify gate may examine. Default min(3n,150), ceiling min(20n,1000).",
      },
      request_id: {
        type: "string",
        description:
          "REQUIRED idempotency key. Derive it from the ask (e.g. 'gyms-texas-2026-07-28'); REUSE the exact same value when retrying the same ask — a duplicate returns the SAME job instead of launching twice. Use a NEW value only for a genuinely new ask.",
      },
      lang: { type: "string", description: "Output language (default: user's language)." },
      confirm: {
        type: "boolean",
        description:
          "Explicit go-ahead, required only for a search that uses quota (qualify:true and/or channels). true = the user approved the quote, go ahead. false = a veto (returns mode:'needs_confirmation', uses nothing). Omitted on such a call → the tool withholds the submit and returns a free quote to show the user first. The default FREE search (no qualify, no channels) needs no confirm.",
      },
      dry_run: {
        type: "boolean",
        description:
          "Validate + worst-case usage estimate + quota forecast. No job, uses nothing. Use before the first quota-using run of a session.",
      },
      wait_seconds: {
        type: "number",
        description:
          "How long to poll before returning (default 45, max 180, 0 = submit + one snapshot). Free searches usually finish inside the window; qualified exploration can take minutes — the result then carries still_running:true and the job_id to check with leadbay_lead_job_status.",
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
    // The workspace's OWN country is redundant, not wrong: the search already
    // spans it. Refusing it failed a scheduled agent's first call on every run,
    // because it re-reads the description each time and never learns from the
    // refusal (product#4132). So it comes off here and the search runs. Any
    // other country-level value still reaches the guard below and is refused.
    const homeCountry = detectCountryLocations(
      params.filters?.locations,
      "filters.locations",
      client.region
    ).filter((hit) => hit.kind === "home_country");
    let countryNote: { note: string } | undefined;
    if (homeCountry.length > 0) {
      const dropped = new Set<unknown>(homeCountry.map((hit) => hit.value));
      const raw: unknown = params.filters!.locations;
      const rest = (Array.isArray(raw) ? raw : [raw]).filter((v) => !dropped.has(v));
      params = {
        ...params,
        filters: { ...params.filters, locations: rest.length > 0 ? (rest as string[]) : undefined },
      };
      const removed = [...dropped].map((v) => `"${v}"`).join(", ");
      countryNote = {
        note:
          rest.length > 0
            ? `Removed ${removed} from filters.locations: a country is never a location filter. The search covers ${rest.map((v) => `"${v}"`).join(", ")} only.`
            : `Removed ${removed} from filters.locations: this workspace holds ${homeCountry[0].country} companies only, so the search already covers all of it.`,
      };
    }
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
    // Normalize the three flags the gate reads BEFORE reading them, and use the
    // normalized values from here on — including on the wire. An untyped
    // `qualify: "true"` is FALSE to `=== true` but TRUE to the backend, so the
    // raw read decided "free", skipped the gate, and posted a body that
    // charged. Measured on production: 94 cost_cents on an unconsented call.
    const qualify = readSpendFlag(params.qualify, "qualify");
    const dryRun = readSpendFlag(params.dry_run, "dry_run");
    const confirm = readSpendFlag(params.confirm, "confirm");
    params = { ...params, qualify, dry_run: dryRun, confirm };

    const buysChannels = (params.channels?.length ?? 0) > 0;
    const buysQualification = qualify === true;
    const isPaid = buysQualification || buysChannels;
    const vetoed = confirm === false;
    const consented = !vetoed && confirm === true;

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
      qualify,
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
      dry_run: dryRun,
    });

    // AFTER the spend gate below would be safer still, but a dry run is the
    // one path that must stay reachable when the gate would withhold — it is
    // how the caller GETS the quote. What made it dangerous was the truthiness
    // read: `dry_run: "false"` is truthy in JS and `false` to the backend, so
    // this branch posted a REAL submit and then labelled the answer
    // `dry_run: true`. `dryRun` is a real boolean now, so `"false"` takes the
    // submit path with the gate in front of it, exactly like an omitted flag.
    if (dryRun === true) {
      const attempt = await submitSearch<McpDryRunResponse>(
        client,
        body,
        undefined,
        ctx
      );
      if (!attempt.ok) return { ...attempt.choice, ...countryNote, region: client.region };
      return {
        dry_run: true,
        ...attempt.data,
        ...sectorNote(attempt.rewritten),
        ...countryNote,
        region: client.region,
      };
    }

    if (isPaid && !consented) {
      let forecast: McpDryRunResponse | null = null;
      let quoteRewritten: Array<{ asked: string; used: string }> = [];
      if (!vetoed) {
        const attempt = await submitSearch<McpDryRunResponse>(
          client,
          { ...body, dry_run: true },
          undefined,
          ctx
        );
        // A quote that cannot name a real sector is not a quote to consent to,
        // so the choice comes back BEFORE the user is asked to approve spend.
        if (!attempt.ok) return { ...attempt.choice, ...countryNote, region: client.region };
        forecast = attempt.data;
        quoteRewritten = attempt.rewritten;
      }
      return {
        mode: "needs_confirmation",
        submitted: false,
        vetoed,
        paid_because: [
          buysQualification
            ? "qualify: true (uses quota per candidate examined)"
            : null,
          buysChannels ? `channels requested: ${params.channels!.join(", ")}` : null,
        ].filter(Boolean),
        quote: forecast,
        estimated_cost: forecast?.estimated_cost ?? null,
        items_requested: forecast?.items_requested ?? null,
        hint: vetoed
          ? "confirm:false vetoed the run — nothing was submitted. Re-call with confirm:true to proceed, or drop qualify/channels for a free search."
          : "Tell the user what will run and that it uses their plan's quota (no amounts, no money), get an explicit go-ahead, then re-call with confirm:true. For a free search instead: omit qualify and channels.",
        ...sectorNote(quoteRewritten),
        ...countryNote,
        region: client.region,
      };
    }

    // preSendSignal, NOT signal. While this POST is queued behind the client's
    // concurrency slots nothing has been sent, so a cancel there is free and
    // provably spends nothing — that is the window this closes. Once it is on
    // the wire it is deliberately left to finish: aborting mid-flight would
    // leave us unable to say whether the backend already committed the job,
    // charged for it, and claimed novelty on the leads.
    const attempt = await submitSearch<McpSubmitResponse>(
      client,
      body,
      { preSendSignal: ctx?.signal },
      ctx
    );
    if (!attempt.ok) return { ...attempt.choice, ...countryNote, region: client.region };
    const submit = attempt.data;
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
    // Every failure past this point must carry submit.job_id: the job exists
    // and may be spending, and this handle is the only way back to it.
    const snapshot = await snapshotAfterSubmit(
      client,
      submit.job_id,
      waitSeconds,
      ctx,
      params.count
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
      items_truncated: snapshot.items_truncated ?? false,
      // Top-level, not only inside next_poll: on a TERMINAL job that truncated,
      // next_poll used to be null, so the rendering rule telling the agent to
      // fetch the rest with `since: next_since` named a cursor the response did
      // not contain. The rows are paid for; the way to reach them cannot be
      // conditional on the job still running.
      next_since: snapshot.next_since ?? null,
      cost: snapshot.cost,
      estimated_cost: submit.estimated_cost,
      explain: snapshot.explain,
      still_running: !done,
      // A finished job can still owe rows: truncation means the drain stopped
      // early, so there is a follow-up action even when done is true. It is a
      // page fetch, not a wait, hence suggested_wait_seconds 0.
      next_poll:
        done && !(snapshot.items_truncated ?? false)
          ? null
          : {
              tool: "leadbay_lead_job_status",
              job_id: submit.job_id,
              // Hand the cursor forward so the follow-up poll continues
              // INCREMENTALLY instead of re-reading (and re-rendering) the
              // rows already delivered in this response.
              since: snapshot.next_since ?? null,
              suggested_wait_seconds: done ? 0 : 60,
            },
      ...sectorNote(attempt.rewritten),
      ...countryNote,
      region: client.region,
    };
  },
};
