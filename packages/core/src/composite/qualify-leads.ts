// leadbay_qualify_leads — POST /mcp/qualify + poll GET /mcp/jobs/{id}
//
// "Qualify these companies I already have, and get me the right contact on
// each" in one server-side job. Refs can be lead ids, websites, name+location
// pairs, stable contact ids from prior results, or the prior_deliveries
// ledger selector. Every ref gets a per-item outcome — a bad ref never fails
// the job. Disqualified leads the org owns are DELIVERED with their negative
// evidence, never silently dropped. Repeat calls reuse every fresh cached
// stage and converge to near-zero cost.
import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext } from "../types.js";
import {
  clampWaitSeconds,
  collectJobSnapshot,
  canonicalSet,
  coerceArrayParams,
  isUuidShaped,
  normalizeUuid,
  presentRequestId,
  remapInputIndexes,
  canonicalLabelSet,
  derivedKey,
  mockedSubmitPreview,
  compactBody,
  splitItems,
  TERMINAL_JOB_STATES,
  waitForJob,
  type McpDryRunResponse,
  type McpSubmitResponse,
} from "./_mcp-job-helpers.js";
import { normalizeDomain } from "./import-leads.js";
import { leadbay_qualify_leads as QUALIFY_LEADS_DESCRIPTION } from "../tool-descriptions.generated.js";

interface QualifyLeadsParams {
  lead_refs?: Array<{
    lead_id?: string;
    website?: string;
    name?: string;
    location?: string;
    contact_id?: string;
  }>;
  prior_deliveries?: {
    job_id?: string;
    since?: string;
    limit?: number;
  };
  qualify?: boolean;
  contact_titles?: string[];
  title_gate?: "strict" | "prefer";
  channels?: Array<"email" | "phone">;
  max_cost?: number;
  request_id?: string;
  lang?: string;
  confirm?: boolean;
  dry_run?: boolean;
  wait_seconds?: number;
}

const DEFAULT_WAIT_SECONDS = 45;

/** Stable idempotency key for a paid batch the caller didn't key itself.
 *  Deterministic over the APPROVED BATCH ITSELF — refs, selector, paid flags,
 *  spend cap — and nothing time-based: a retry of the same approval must
 *  dedupe even if it lands after midnight or hours later. A genuinely
 *  different batch (different refs, channels, titles, or a raised max_cost
 *  after a stop_reason: max_cost) hashes differently and runs as a new job.
 *  A caller who wants a deliberate re-run of an identical batch passes an
 *  explicit request_id. */
/** MCP args arrive unvalidated, and `coerceArrayParams` turns a scalar
 *  `lead_refs: "acme.com"` into `["acme.com"]` — a STRING where the schema
 *  promises an object. Read as an object that yields an all-null ref, so EVERY
 *  string ref canonicalizes identically: two different companies derive the
 *  same `qualify-auto-*` key and the second batch dedupes onto the first
 *  PAID job. The raw string is also posted as-is, which the backend 400s
 *  after this tool already promised a quote.
 *
 *  Map the shorthand onto the shape the schema documents instead — a UUID is
 *  a lead_id, a domain is a website, anything else is a name — so the derived
 *  key and the submitted body agree and describe the company the caller meant. */
function normalizeLeadRefs(
  refs: QualifyLeadsParams["lead_refs"]
): QualifyLeadsParams["lead_refs"] {
  if (!Array.isArray(refs)) return refs;
  return refs.map((ref) => {
    if (typeof ref !== "string") return ref;
    const value = (ref as string).trim();
    if (!value) return ref;
    if (isUuidShaped(value)) return { lead_id: value };
    return normalizeDomain(value) ? { website: value } : { name: value };
  });
}

/** MCP args are not schema-validated before dispatch, so `lead_refs` can carry
 *  `null`, a number, or an array where an object belongs. `normalizeLeadRefs`
 *  deliberately passes non-strings through untouched, so those entries reached
 *  `derivedRequestId`, where the first property access threw a raw TypeError —
 *  BEFORE the spend gate could return a quote. A malformed ref is a caller
 *  mistake, and the tool's contract is to answer with a named, actionable
 *  error rather than a stack trace or a silent drop: dropping would qualify
 *  and BILL a subset of the batch the user listed, without saying so. */
/** Every identifying field the ref shape declares. Validated as a set rather
 *  than one-by-one so adding a field to `lead_refs` cannot silently reopen the
 *  crash: a new field left off this list is caught by the typecheck below. */
const LEAD_REF_FIELDS = [
  "lead_id",
  "website",
  "name",
  "location",
  "contact_id",
] as const satisfies ReadonlyArray<
  keyof NonNullable<QualifyLeadsParams["lead_refs"]>[number]
>;

function rejectMalformedLeadRefs(refs: QualifyLeadsParams["lead_refs"]): void {
  if (!Array.isArray(refs)) return;
  const bad: string[] = [];
  refs.forEach((ref, i) => {
    if (ref === null || typeof ref !== "object" || Array.isArray(ref)) {
      bad.push(`${i} (not an object)`);
      return;
    }
    // Field TYPES, not just the container. `{website: 123}` cleared the object
    // check and then died on `.trim()` while deriving the key — the same crash
    // one level in. `undefined` and absent are both fine; anything present and
    // non-string is not.
    for (const field of LEAD_REF_FIELDS) {
      const value = (ref as Record<string, unknown>)[field];
      if (value !== undefined && typeof value !== "string") {
        bad.push(`${i}.${field} (${value === null ? "null" : typeof value})`);
      }
    }
  });
  if (bad.length === 0) return;
  throw {
    error: true,
    code: "INVALID_LEAD_REF",
    message: `lead_refs has ${bad.length} invalid entr${bad.length === 1 ? "y" : "ies"}: ${bad.join(", ")}.`,
    hint: "Each ref is an object whose fields are STRINGS — {lead_id} | {website} | {name, location?} | {contact_id}. A bare string is accepted and reshaped; null, numbers, arrays and non-string field values are not. Fix or drop those entries and re-call.",
  };
}

/** Trim + lowercase a value that SHOULD be a string, without trusting that it
 *  is. Non-strings fold to null rather than throwing, so an unvalidated caller
 *  cannot turn key derivation into a TypeError. */
function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  return v ? v : null;
}

function derivedRequestId(params: QualifyLeadsParams): string {
  // JSON-serialize each ref rather than joining raw values with delimiters.
  // Field names alone were not enough: a value CONTAINING the delimiters
  // forged a different ref's serialization, so {website:"acme~name=Paris"} and
  // {website:"acme", name:"Paris~name="} hashed identically. JSON escapes the
  // separators, so no value can impersonate a field boundary.
  // Sorted AND de-duplicated: the backend collapses duplicate refs into one
  // item, so a batch repeating a website and the same batch with it listed
  // once are the same approved work. Leaving duplicates in forked the key, and
  // a retry that happened to dedupe would then re-run the whole paid job.
  const refs = canonicalSet(
    (params.lead_refs ?? []).map((r) => {
      // Defence in depth: rejectMalformedLeadRefs already guarantees every
      // field is a string, but key derivation must not be the thing that
      // crashes if a future caller reaches it without that guard. `text()`
      // folds a non-string to null instead of throwing on .trim().
      const website = text(r.website);
      return [
        // UUIDs are case-insensitive to the backend, so an uppercase id and
        // its lowercase form are the same lead and must share a key.
        normalizeUuid(r.lead_id),
        normalizeUuid(r.contact_id),
        // Normalize the website the SAME way the resolver does, so a pasted
        // "https://Acme.com/" and a retry's "acme.com" resolve to one company
        // AND to one key. Fall back to the trimmed/lowercased raw value when
        // it is not domain-shaped, rather than dropping the field.
        website ? normalizeDomain(website) ?? website : null,
        text(r.name),
        text(r.location),
      ];
    })
  );
  // JSON the WHOLE shape for the same reason as the refs above: free-text
  // values (contact_titles, lang) must not be able to forge a field boundary
  // by containing a delimiter.
  const shape = {
    refs,
    // The WHOLE selector, not just the job id: qualifying the first 50 of a
    // delivery job and then the next 50 are different batches, and collapsing
    // them to one key would make the second submit look like a duplicate and
    // leave those refs unqualified.
    prior: [
      // UUID-folded like the refs above: the backend resolves the same
      // delivery job regardless of casing, so casing alone must not fork
      // the key and re-run a paid batch.
      normalizeUuid(params.prior_deliveries?.job_id),
      params.prior_deliveries?.since ?? null,
      params.prior_deliveries?.limit ?? null,
    ],
    // Canonicalize to the value the BACKEND will apply, so an approval that
    // omits a field and a retry that passes that field's documented default
    // derive the same key instead of launching a second paid job.
    qualify: params.qualify !== false,
    channels: canonicalSet(params.channels),
    contact_titles: canonicalLabelSet(params.contact_titles),
    // Same canonicalization as the search path: with contact_titles present
    // the backend applies `prefer` when the field is omitted, so an approval
    // that omits it and a retry that passes the materialized default describe
    // identical work. Hashing the omission as null forked the key and let the
    // retry escape dedupe into a second paid qualification / channel purchase.
    title_gate:
      params.title_gate ??
      ((params.contact_titles?.length ?? 0) > 0 ? "prefer" : null),
    // The cap is part of the approval: raising it after a stop_reason:max_cost
    // is a NEW approved run, and must not dedupe onto the capped job.
    max_cost: params.max_cost ?? null,
    // Same for the output language — re-running the batch in another language
    // must not return the earlier job with evidence in the previous one.
    lang: params.lang ?? null,
  };
  return derivedKey("qualify-auto", shape);
}

export const qualifyLeads: Tool<QualifyLeadsParams, any> = {
  name: "leadbay_qualify_leads",
  annotations: {
    title: "Qualify + get the right contact on known leads",
    readOnlyHint: false,
    // Spends real money (fresh qualification, and email/phone reveals when
    // channels are requested), same as bulk_qualify_leads / enrich-titles.
    // Hosts and approval layers key their prompts off this flag, so a paid
    // job submitter must not advertise itself as harmless.
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  write: true,
  description: QUALIFY_LEADS_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      lead_refs: {
        type: "array",
        description:
          "Companies to qualify (max 500). Each ref needs at least one identifying field. Duplicate lead_ids collapse into one item.",
        items: {
          type: "object",
          properties: {
            lead_id: { type: "string", description: "Leadbay lead UUID." },
            website: { type: "string" },
            name: { type: "string" },
            location: {
              type: "string",
              description: "Disambiguates name-only refs (city/region).",
            },
            contact_id: {
              type: "string",
              description:
                "Stable lead_contact id from a prior result — enrichment then targets EXACTLY this person, never a re-match.",
            },
          },
          additionalProperties: false,
        },
      },
      prior_deliveries: {
        type: "object",
        description:
          "Selector expanding the org's past MCP deliveries into refs — billed leads stay re-readable after result expiry. Combine with lead_refs or use alone.",
        properties: {
          job_id: { type: "string" },
          since: { type: "string", description: "ISO instant lower bound." },
          limit: { type: "number" },
        },
        additionalProperties: false,
      },
      qualify: {
        type: "boolean",
        description:
          "Fresh AI qualification (default true; ~94 cost_cents per lead needing fresh research+scoring, cache-free when a fresh dossier exists). Owned disqualified leads come back WITH their negative evidence.",
      },
      contact_titles: {
        type: "array",
        items: { type: "string" },
        description: "Wanted decision-maker titles (max 10), matched semantically.",
      },
      title_gate: {
        type: "string",
        enum: ["strict", "prefer"],
        description:
          "strict = only items with a matching known contact deliver a contact; prefer = matched first, rest flagged.",
      },
      channels: {
        type: "array",
        items: { type: "string", enum: ["email", "phone"] },
        description:
          "Channels to PURCHASE (email 25c, phone 250c, success-only, already-owned values are free). Empty = free identity tier.",
      },
      max_cost: {
        type: "number",
        description: "Spend cap in cost_cents (plan-tier default when unset).",
      },
      request_id: {
        type: "string",
        description:
          "Recommended idempotency key — REUSE the same value when retrying the same batch so a retry returns the SAME job instead of re-spending.",
      },
      lang: { type: "string", description: "Output language (default: user's language)." },
      confirm: {
        type: "boolean",
        description:
          "Explicit spend decision for the PAID work (fresh qualification and/or channel purchases). true = the user approved the quote, go ahead. false = a veto (returns mode:'needs_confirmation', spends nothing). Omitted on a paid call → the tool withholds the submit and returns a free quote to show the user first. A fully FREE call (qualify:false and no channels) needs no confirm.",
      },
      dry_run: {
        type: "boolean",
        description:
          "Validate + worst-case cost + quota forecast. No job, no spend.",
      },
      wait_seconds: {
        type: "number",
        description:
          "How long to poll before returning (default 45, max 180, 0 = submit + one snapshot). Large or research-heavy batches can take minutes — the result then carries still_running:true and the job_id for leadbay_lead_job_status.",
      },
    },
    additionalProperties: false,
  },
  execute: async (
    client: LeadbayClient,
    params: QualifyLeadsParams,
    ctx?: ToolContext
  ) => {
    // Unvalidated MCP args can arrive singular (`channels: "email"`,
    // `lead_refs: {website}`); coerce BEFORE the spend gate so a shape slip is
    // never a TypeError in place of a quote.
    params = coerceArrayParams(params, [
      "lead_refs",
      "contact_titles",
      "channels",
    ]);
    // …and a coerced scalar is a STRING inside that array, which every
    // downstream reader treats as an object. Reshape before the spend gate so
    // the quote, the idempotency key and the posted body all describe the same
    // companies.
    params = { ...params, lead_refs: normalizeLeadRefs(params.lead_refs) };
    // AFTER the string reshape (so a bare string is not called malformed) and
    // BEFORE the spend gate and key derivation, both of which read ref fields.
    rejectMalformedLeadRefs(params.lead_refs);
    // Spend gate. `qualify` defaults to TRUE on the backend (~94 cost_cents per
    // lead needing fresh research), so a bare call carrying only lead_refs is a
    // PAID submit — up to 500 refs — that the user never approved. Prose in the
    // description does not prevent this (the same lesson as the country-label
    // rejection above and the enrich-titles consent gate, product#3848): the
    // withhold has to live in code.
    //
    // FREE calls pass straight through: qualify:false with no channels buys
    // nothing, so demanding consent there would be friction with no spend.
    const buysChannels = (params.channels?.length ?? 0) > 0;
    const buysQualification = params.qualify !== false;
    const isPaid = buysQualification || buysChannels;
    // An explicit confirm:false is a VETO — decline the spend outright, no
    // quote round-trip. Distinct from confirm being absent (which earns a quote).
    const vetoed = params.confirm === false;
    const consented = !vetoed && params.confirm === true;

    // A paid submit without an idempotency key can be re-run by any timeout or
    // agent retry, re-charging fresh qualification and channel purchases for
    // the same refs. `request_id` is optional on this tool (unlike the search),
    // so derive a stable one from the batch when the caller omits it: same refs
    // + same paid flags on the same day = same key = backend dedupe.
    // Blank is missing: a caller can fill this optional field with "" and `??`
    // would ship it as the key — see presentRequestId.
    const requestId =
      presentRequestId(params.request_id) ??
      (isPaid ? derivedRequestId(params) : undefined);

    const body = compactBody({
      lead_refs: params.lead_refs,
      prior_deliveries: params.prior_deliveries,
      qualify: params.qualify,
      contact_titles: params.contact_titles,
      title_gate: params.title_gate,
      channels: params.channels,
      max_cost: params.max_cost,
      request_id: requestId,
      lang: params.lang,
      dry_run: params.dry_run,
    });

    if (params.dry_run) {
      const forecast = await client.request<McpDryRunResponse>(
        "POST",
        "/mcp/qualify",
        body
      );
      return { dry_run: true, ...forecast, region: client.region };
    }

    if (isPaid && !consented) {
      // Withhold the submit. Run the free dry_run so the user sees a REAL
      // worst-case quote (not an invented estimate) before deciding — except on
      // an explicit veto, where we spend nothing at all, not even a round-trip.
      const forecast = vetoed
        ? null
        : await client.request<McpDryRunResponse>("POST", "/mcp/qualify", {
            ...body,
            dry_run: true,
          });
      return {
        mode: "needs_confirmation",
        submitted: false,
        vetoed,
        paid_because: [
          buysQualification
            ? "qualify is on (backend default is true — pass qualify:false to keep it free)"
            : null,
          buysChannels ? `channels requested: ${params.channels!.join(", ")}` : null,
        ].filter(Boolean),
        quote: forecast,
        estimated_cost: forecast?.estimated_cost ?? null,
        items_requested: forecast?.items_requested ?? null,
        hint: vetoed
          ? "confirm:false vetoed the spend — nothing was submitted. Re-call with confirm:true to proceed, or qualify:false with no channels for a free pass."
          : "Show the user this worst-case quote and get an explicit go-ahead, then re-call with confirm:true. For a free pass instead: qualify:false and no channels.",
        region: client.region,
      };
    }

    // preSendSignal, NOT signal — same reasoning as the /mcp/search submit: a
    // cancel while QUEUED provably spent nothing, but an in-flight POST may
    // already have committed and charged, so it is left to finish.
    const submit = await client.request<McpSubmitResponse>(
      "POST",
      "/mcp/qualify",
      body,
      { preSendSignal: ctx?.signal }
    );
    const mocked = mockedSubmitPreview(
      submit,
      "leadbay_qualify_leads",
      client.region
    );
    if (mocked) return mocked;
    const waitSeconds = clampWaitSeconds(
      params.wait_seconds,
      DEFAULT_WAIT_SECONDS
    );
    const snapshot =
      waitSeconds > 0
        ? await waitForJob(
            client,
            submit.job_id,
            waitSeconds,
            ctx,
            submit.items_requested
          )
        : await collectJobSnapshot(
            client,
            submit.job_id,
            undefined,
            undefined,
            ctx?.signal
          );

    const done = TERMINAL_JOB_STATES.has(snapshot.job.state);

    // A duplicate submit returns the ORIGINAL job. Its ref.input_indexes
    // describe the order THAT request used, and this key is deliberately
    // order-insensitive, so a reordered retry would map each verdict onto the
    // wrong company for the current caller. Re-point them at this caller's
    // lead_refs, or null them when the mapping cannot be proven.
    const indexed = (submit.duplicate ?? false)
      ? remapInputIndexes(snapshot.items, params.lead_refs)
      : { items: snapshot.items, remapped: true };
    const view = { ...snapshot, items: indexed.items };

    return {
      job_id: submit.job_id,
      // Echo the key actually sent, so a retry can reuse it verbatim.
      request_id: requestId ?? null,
      duplicate_submit: submit.duplicate ?? false,
      state: snapshot.job.state,
      done,
      summary: {
        refs_submitted: params.lead_refs?.length ?? 0,
        items_requested: submit.items_requested,
        delivered: snapshot.funnel.delivered ?? 0,
        delivered_callable: snapshot.funnel.delivered_callable ?? 0,
        degraded: snapshot.funnel.degraded ?? 0,
        resolved: snapshot.funnel.resolved ?? null,
        not_in_universe: snapshot.funnel.not_in_universe ?? null,
        stop_reason: snapshot.funnel.stop_reason ?? null,
      },
      funnel: snapshot.funnel,
      // Per-item outcomes in input order where known (ref.input_indexes maps
      // back to the caller's lead_refs positions). Items carry the full
      // QualifiedLead payload when delivered/degraded, and an honest
      // status_reason (not_in_universe, low_confidence_identity, ...) when
      // skipped — a skip is an ANSWER about that ref, not an error.
      items: view.items,
      // On a duplicate submit whose indexes could not be re-pointed at this
      // caller's refs, input_indexes are null rather than stale — match items
      // by `ref.requested_as` / `lead_id` instead.
      input_indexes_remapped: (submit.duplicate ?? false)
        ? indexed.remapped
        : null,
      // ...and the same outcomes pre-split, because the shared
      // rendering/lead-delivery-table contract this tool's description
      // mandates reads deliveries from `leads[]` and skips from `skipped[]`.
      // Returning only `items` left an agent following the RENDER block with
      // two empty tables; the sibling tools (find_new_leads, lead_job_status)
      // both split. `items` stays for input-order per-ref mapping.
      ...splitItems(view),
      items_truncated: snapshot.items_truncated ?? false,
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
