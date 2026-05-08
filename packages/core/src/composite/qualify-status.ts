import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext, RequestMeta } from "../types.js";
import { isValidBulkId } from "../jobs/bulk-store.js";
import {
  refreshLeadStates,
  buildQuestionOrder,
  prequalifiedLeads,
  type QualifyResult,
} from "./_qualify-helpers.js";

interface QualifyStatusParams {
  qualify_id: string;
}

interface QualifyStatusResult {
  qualify_id: string;
  launched_at: string;
  status: "pending" | "launched" | "failed";
  // Underlying file-import handles (one per chunk).
  import_ids: string[];
  lens_id: number;

  // The lead set this qualify_id covers.
  lead_ids: string[];

  // Live state, refreshed at call time.
  qualified: QualifyResult[];
  still_running: Array<{ lead_id: string }>;
  // Per-lead errors observed at refresh time. A lead whose /web_fetch AND
  // /ai_agent_responses both 404 is reported here as `error: "NOT_FOUND"`
  // (rather than letting it pile up in still_running[] forever).
  failed: Array<{ lead_id: string; error: string }>;
  // Lead ids that exist in the org but are NOT in the active lens — backend
  // won't qualify them. Surfaced separately so the agent stops polling.
  // Membership is re-checked at status time (a lead may have been added to
  // the lens between import_and_qualify and this status call).
  not_in_lens: string[];

  // Snapshot of caller-supplied budgets (informational; not enforced by status).
  per_lead_budget_ms?: number;
  total_budget_ms?: number;

  region: "us" | "fr" | "custom";
  _meta: RequestMeta;
}

export const qualifyStatus: Tool<
  QualifyStatusParams,
  QualifyStatusResult
> = {
  name: "leadbay_qualify_status",
  annotations: {
    title: "Poll import-and-qualify status",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description:
    "Retrieve the current state of an import_and_qualify launch by `qualify_id`. Returns the same `qualified[]` " +
    "/ `still_running[]` shape as the original composite, refreshed against the backend at call time. The handle " +
    "is persisted to ~/.leadbay/bulks.json with a 30-day TTL and survives MCP restart.\n\n" +
    "When to use: after leadbay_import_and_qualify returned a qualify_id with non-empty `still_running[]`, call " +
    "this tool a few minutes later (or hours) to retrieve the now-completed qualifications without re-running " +
    "the import or re-spending qualify quota.\n" +
    "When NOT to use: as a substitute for leadbay_research_lead — that's a deeper per-lead profile and includes " +
    "contacts. This tool is purely the qualification answers + signals_count.",
  inputSchema: {
    type: "object",
    properties: {
      qualify_id: {
        type: "string",
        description:
          "UUIDv4 returned by leadbay_import_and_qualify when at least one lead was still running.",
      },
    },
    required: ["qualify_id"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      qualify_id: { type: "string", description: "Echoed UUIDv4 handle." },
      launched_at: { type: "string", description: "ISO timestamp of original launch." },
      status: { type: "string", description: "'launched' on success (other states surface as error envelopes)." },
      import_ids: {
        type: "array",
        description: "Underlying file-import handle ids (one per chunk).",
        items: { type: "string" },
      },
      lens_id: { type: "number", description: "Lens id the qualification ran against." },
      lead_ids: {
        type: "array",
        description: "Lead UUIDs covered by this qualify_id (echoed from launch).",
        items: { type: "string" },
      },
      qualified: {
        type: "array",
        description:
          "Leads whose qualification has settled. Each entry: {lead_id, qualification_summary, signals_count, ...}.",
        items: { type: "object" },
      },
      still_running: {
        type: "array",
        description: "Leads still being qualified at refresh time.",
        items: { type: "object" },
      },
      failed: {
        type: "array",
        description:
          "Per-lead errors observed at refresh (e.g., 404 on /web_fetch + /ai_agent_responses).",
        items: { type: "object" },
      },
      not_in_lens: {
        type: "array",
        description:
          "Lead ids that exist in the org but aren't members of the active lens — backend won't qualify them; agent should stop polling.",
        items: { type: "string" },
      },
      per_lead_budget_ms: {
        type: "number",
        description: "Caller-supplied per-lead timeout (informational only at status time).",
      },
      total_budget_ms: {
        type: "number",
        description: "Caller-supplied total timeout (informational only at status time).",
      },
      region: { type: "string" },
      _meta: { type: "object" },
    },
    required: [
      "qualify_id",
      "status",
      "import_ids",
      "lens_id",
      "lead_ids",
      "qualified",
      "still_running",
      "failed",
      "not_in_lens",
      "region",
      "_meta",
    ],
  },
  execute: async (
    client: LeadbayClient,
    params: QualifyStatusParams,
    ctx?: ToolContext
  ): Promise<QualifyStatusResult> => {
    if (!isValidBulkId(params.qualify_id)) {
      throw client.makeError(
        "BULK_INVALID_ID",
        "qualify_id is not a valid UUIDv4",
        "Pass the qualify_id returned by leadbay_import_and_qualify verbatim.",
        ""
      );
    }
    if (!ctx?.bulkTracker) {
      throw client.makeError(
        "BULK_TRACKER_UNAVAILABLE",
        "No BulkTracker configured on this MCP instance",
        "leadbay_qualify_status needs a BulkTracker. Upgrade to @leadbay/mcp ≥0.5.0 or set LEADBAY_BULK_STORE_ALLOW_MEMORY=1.",
        ""
      );
    }

    const record = await ctx.bulkTracker.getQualify(params.qualify_id);
    if (!record) {
      // Could be wrong kind, expired (TTL), missing, or never existed.
      const any = await ctx.bulkTracker.get(params.qualify_id);
      if (any && any.kind !== "qualify") {
        throw client.makeError(
          "BULK_WRONG_KIND",
          "This bulk_id was created by leadbay_enrich_titles, not leadbay_import_and_qualify",
          "Call leadbay_bulk_enrich_status with this id instead.",
          ""
        );
      }
      throw client.makeError(
        "BULK_NOT_FOUND",
        "No qualify record for that qualify_id",
        "It may have expired (30-day TTL) or the MCP process was restarted without persistence. Re-launch via leadbay_import_and_qualify.",
        ""
      );
    }

    if (record.status === "pending") {
      throw client.makeError(
        "BULK_PENDING",
        "Qualify record is in 'pending' state — the launch may be in flight or crashed before launch ack",
        "Retry leadbay_qualify_status in a few seconds. If it persists >60s, relaunch via leadbay_import_and_qualify.",
        ""
      );
    }

    if (record.status === "failed") {
      throw client.makeError(
        "BULK_LAUNCH_FAILED",
        "The original import_and_qualify launch failed; no qualifications were ordered",
        "Call leadbay_import_and_qualify again — the failed record won't block a fresh launch.",
        ""
      );
    }

    if (record.status === "cancelled") {
      throw client.makeError(
        "BULK_CANCELLED",
        "The qualify run was cancelled (ctx.signal aborted by the client mid-flight); no further qualifications are in flight",
        "Call leadbay_import_and_qualify again with the same input to relaunch — the cancelled record won't block a fresh launch.",
        ""
      );
    }

    // Phase 1/3: pull the question order so qualifications come back in
    // mission-importance order. Surface a tick so the agent can stream
    // long-poll progress to the user (otherwise the spinner is mute).
    ctx?.progress?.({
      progress: 1,
      total: 3,
      message: "Loading qualification questions…",
    });
    let questionOrder = undefined;
    try {
      const taste = await client.resolveTasteProfile();
      questionOrder = buildQuestionOrder(taste.qualificationQuestions ?? []);
    } catch {
      // best-effort
    }

    // Phase 2/3: re-check lens membership (a lead may have been added to
    // the lens since the original import). Best-effort.
    ctx?.progress?.({
      progress: 2,
      total: 3,
      message: `Checking lens membership for ${record.lead_ids.length} lead${record.lead_ids.length === 1 ? "" : "s"}…`,
    });
    let notInLensSet = new Set<string>();
    try {
      const pre = await prequalifiedLeads(
        client,
        record.lead_ids,
        record.lens_id,
        ctx
      );
      notInLensSet = pre.not_in_lens;
    } catch {
      // best-effort; absence of not_in_lens is the same as "all in lens"
    }

    // Phase 3/3: refresh per-lead state (web_fetch + ai_agent_responses).
    ctx?.progress?.({
      progress: 3,
      total: 3,
      message: `Refreshing qualification state for ${record.lead_ids.length} lead${record.lead_ids.length === 1 ? "" : "s"}…`,
    });
    const fresh = await refreshLeadStates(client, record.lead_ids, questionOrder);
    const failed: Array<{ lead_id: string; error: string }> = [];
    const qualified: QualifyResult[] = [];
    const still_running: Array<{ lead_id: string }> = [];
    for (const r of fresh) {
      if (r._failedCode) {
        failed.push({ lead_id: r.lead_id, error: r._failedCode });
        continue;
      }
      if (notInLensSet.has(r.lead_id) && r._stillRunning) {
        // Surfacing as not_in_lens rather than still_running terminates the
        // agent's poll loop — backend won't qualify this lead.
        continue;
      }
      if (r._stillRunning) {
        still_running.push({ lead_id: r.lead_id });
        continue;
      }
      const { _stillRunning, _failedCode, ...rest } = r;
      qualified.push(rest);
    }

    const out: QualifyStatusResult = {
      qualify_id: record.bulk_id,
      launched_at: record.launched_at,
      status: record.status,
      import_ids: record.import_ids,
      lens_id: record.lens_id,
      lead_ids: record.lead_ids,
      qualified,
      still_running,
      failed,
      not_in_lens: [...notInLensSet],
      region: client.region,
      _meta: client.lastMeta ?? {
        region: client.region,
        endpoint: "GET /leads/<id>/web_fetch + /ai_agent_responses",
        latency_ms: null,
        retry_after: null,
      },
    };
    if (record.per_lead_budget_ms !== undefined) out.per_lead_budget_ms = record.per_lead_budget_ms;
    if (record.total_budget_ms !== undefined) out.total_budget_ms = record.total_budget_ms;
    return out;
  },
};
