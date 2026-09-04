// leadbay_lead_job_status — GET /mcp/jobs/{id}
//
// Cumulative snapshot of a find_new_leads / qualify_leads job. Items are
// immutable once emitted; the optional `since` cursor pages only what's new
// since the last poll. Terminal projections are server-side: past the 30-min
// wall clock a job reads completed_partial(time_budget), past the 30-day TTL
// it reads expired — never an eternal `running`.
import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext } from "../types.js";
import {
  clampWaitSeconds,
  collectJobSnapshot,
  splitItems,
  TERMINAL_JOB_STATES,
  waitForJob,
} from "./_mcp-job-helpers.js";
import { leadbay_lead_job_status as LEAD_JOB_STATUS_DESCRIPTION } from "../tool-descriptions.generated.js";

interface LeadJobStatusParams {
  job_id: string;
  since?: string;
  limit?: number;
  wait_seconds?: number;
}

export const leadJobStatus: Tool<LeadJobStatusParams, any> = {
  name: "leadbay_lead_job_status",
  annotations: {
    title: "Poll a lead-delivery job",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: LEAD_JOB_STATUS_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      job_id: {
        type: "string",
        description:
          "The job_id returned by leadbay_find_new_leads or leadbay_qualify_leads.",
      },
      since: {
        type: "string",
        description:
          "Opaque cursor from a previous poll's next_since — returns only items emitted after it. Omit for the full snapshot.",
      },
      limit: {
        type: "number",
        description: "Items per page, 1-100 (default 100; pages are auto-collected).",
      },
      wait_seconds: {
        type: "number",
        description:
          "0 (default) = instant snapshot. >0 = keep polling up to this many seconds until the job is terminal — use ~60 when the user asked to wait for results.",
      },
    },
    required: ["job_id"],
    additionalProperties: false,
  },
  execute: async (
    client: LeadbayClient,
    params: LeadJobStatusParams,
    ctx?: ToolContext
  ) => {
    const waitSeconds = clampWaitSeconds(params.wait_seconds, 0);
    const snapshot =
      waitSeconds > 0
        ? await waitForJob(
            client,
            params.job_id,
            waitSeconds,
            ctx,
            undefined,
            params.since,
            params.limit
          )
        : await collectJobSnapshot(
            client,
            params.job_id,
            params.since,
            params.limit,
            ctx?.signal
          );

    const done = TERMINAL_JOB_STATES.has(snapshot.job.state);
    const { leads, skipped } = splitItems(snapshot);
    return {
      job_id: params.job_id,
      state: snapshot.job.state,
      done,
      funnel: snapshot.funnel,
      leads,
      skipped,
      // Surfaced so the renderer never presents a partial page set as the whole
      // result: `leads` is a prefix, and next_since resumes it.
      items_truncated: snapshot.items_truncated ?? false,
      next_since: snapshot.next_since ?? null,
      cost: snapshot.cost,
      explain: snapshot.explain,
      still_running: !done,
      // Truncation leaves rows unread even on a finished job, so the follow-up
      // action survives `done` — same rule as the two submit tools.
      next_poll:
        done && !(snapshot.items_truncated ?? false)
          ? null
          : {
            tool: "leadbay_lead_job_status",
            job_id: params.job_id,
            // Same incremental handoff as the submit tools — following
            // next_poll without the cursor re-reads the rows just returned.
            since: snapshot.next_since ?? null,
            suggested_wait_seconds: done ? 0 : 60,
          },
      region: client.region,
    };
  },
};
