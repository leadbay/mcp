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
  mockedSubmitPreview,
  compactBody,
  splitItems,
  TERMINAL_JOB_STATES,
  waitForJob,
  type McpDryRunResponse,
  type McpSubmitResponse,
} from "./_mcp-job-helpers.js";
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

export const qualifyLeads: Tool<QualifyLeadsParams, any> = {
  name: "leadbay_qualify_leads",
  annotations: {
    title: "Qualify + get the right contact on known leads",
    readOnlyHint: false,
    destructiveHint: false,
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

    const body = compactBody({
      lead_refs: params.lead_refs,
      prior_deliveries: params.prior_deliveries,
      qualify: params.qualify,
      contact_titles: params.contact_titles,
      title_gate: params.title_gate,
      channels: params.channels,
      max_cost: params.max_cost,
      request_id: params.request_id,
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

    const submit = await client.request<McpSubmitResponse>(
      "POST",
      "/mcp/qualify",
      body
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
        : await collectJobSnapshot(client, submit.job_id);

    const done = TERMINAL_JOB_STATES.has(snapshot.job.state);
    return {
      job_id: submit.job_id,
      request_id: params.request_id ?? null,
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
      items: snapshot.items,
      // ...and the same outcomes pre-split, because the shared
      // rendering/lead-delivery-table contract this tool's description
      // mandates reads deliveries from `leads[]` and skips from `skipped[]`.
      // Returning only `items` left an agent following the RENDER block with
      // two empty tables; the sibling tools (find_new_leads, lead_job_status)
      // both split. `items` stays for input-order per-ref mapping.
      ...splitItems(snapshot),
      cost: snapshot.cost,
      estimated_cost: submit.estimated_cost,
      explain: snapshot.explain,
      still_running: !done,
      next_poll: done
        ? null
        : {
            tool: "leadbay_lead_job_status",
            job_id: submit.job_id,
            suggested_wait_seconds: 60,
          },
      region: client.region,
    };
  },
};
