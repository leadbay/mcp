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
  compactBody,
  normalizeSearchFilters,
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
  dry_run?: boolean;
  wait_seconds?: number;
}

const DEFAULT_WAIT_SECONDS = 45;

export const findNewLeads: Tool<FindNewLeadsParams, any> = {
  name: "leadbay_find_new_leads",
  annotations: {
    title: "Find new leads (net-new ICP search)",
    readOnlyHint: false,
    destructiveHint: false,
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
        description: "Caller-side novelty belt on top of the server-side one (max 500 ids).",
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
      exclude_lead_ids: params.exclude_lead_ids,
      novelty: params.novelty,
      max_cost: params.max_cost,
      exploration_cap: params.exploration_cap,
      request_id: params.request_id,
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

    const submit = await client.request<McpSubmitResponse>(
      "POST",
      "/mcp/search",
      body
    );
    const waitSeconds = clampWaitSeconds(
      params.wait_seconds,
      DEFAULT_WAIT_SECONDS
    );
    const snapshot =
      waitSeconds > 0
        ? await waitForJob(client, submit.job_id, waitSeconds, ctx, params.count)
        : await collectJobSnapshot(client, submit.job_id);

    const done = TERMINAL_JOB_STATES.has(snapshot.job.state);
    const { leads, skipped } = splitItems(snapshot);
    return {
      job_id: submit.job_id,
      request_id: params.request_id,
      duplicate_submit: submit.duplicate ?? false,
      state: snapshot.job.state,
      done,
      summary: {
        requested: params.count,
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
            suggested_wait_seconds: 60,
          },
      region: client.region,
    };
  },
};
