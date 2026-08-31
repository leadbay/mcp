import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";
import { leadbay_set_lead_status as SET_LEAD_STATUS_DESCRIPTION } from "../tool-descriptions.generated.js";
import { LEAD_STATUSES } from "../composite/import-leads.js";

// leadbay_set_lead_status writes the ORG-WIDE CRM status (the LeadStatus enum in
// the backend's models/leads/LeadStatus.kt) — the same field the website's status
// selector writes and the one a CSV import maps via `mappings.statuses`.
//
// NOT the same thing as the epilogue status (leadbay_set_epilogue_status /
// report_outreach's `epilogue_status`), which records the disposition of one
// outreach attempt and feeds pull_followups ranking. Two systems, two endpoints;
// setting one never sets the other. The tool description spells out the split
// because conflating them is the obvious failure mode.
//
// Granular-shaped (a thin relay per lead, no orchestration) so it lives in
// tools/ and stays OUT of COMPOSITE_FILE_TOOL_NAMES — no `_triggered_by`
// mandate, which is what lets the artifact runtime's status dropdown call it.
// Registered in compositeWriteTools (NOT granularWriteTools) so it is on the
// default surface without LEADBAY_MCP_ADVANCED — same treatment as
// likeLead/dislikeLead and the contact-management tools.

// ─── Wire shape ──────────────────────────────────────────────────────────────
//
// Verified against the backend OpenAPI spec (frontend/packages/api/open-api.json,
// mirrored as generated RTK-Query types in frontend/packages/state/api/index.ts):
//
//   POST /leads/{leadId}/set_status       SetStatusRequest { status?: LeadStatus }
//   POST /leads/{leadId}/set_status_date  { date: string }
//
// NOTE the date key is `date`, NOT `status_date` — the two endpoints do not share
// a field name. A wrong key on set_status is accepted as an empty object by the
// Kotlin decoder (SetStatusPayload.status is nullable), so a typo there fails
// SILENTLY as a no-op rather than a 400.
//
// The spec advertises `format: date` ("2017-07-21") but that is WRONG: the
// backend's SetStatusDatePayload.date is an `Instant` behind InstantSerializer,
// which is a bare `Instant.parse(string)`. A calendar-only date is rejected with
// "JSON deserialization error" — so widen the caller's YYYY-MM-DD to midnight
// UTC before sending. (backend/routes/payloads/SetStatusDatePayload.kt)
//
// Both routes are per-lead. `set_status_date` is a SEPARATE call: the backend
// stamps "now" when only set_status is sent, so a date is only recorded when the
// caller explicitly supplies one.
const statusPath = (leadId: string) => `/leads/${encodeURIComponent(leadId)}/set_status`;
const statusDatePath = (leadId: string) =>
  `/leads/${encodeURIComponent(leadId)}/set_status_date`;
const statusBody = (status: string) => ({ status });
const statusDateBody = (date: string) => ({ date: `${date}T00:00:00Z` });

// Per-lead fan-out bound. The epilogue endpoint is bulk (one call, up to 1000
// leads); these routes are not, so the cap is far lower — 200 leads is already
// up to 400 HTTP calls.
const MAX_LEADS = 200;
// Concurrent in-flight writes. Kept modest: this is a write fan-out against a
// shared org record, not a read.
const CONCURRENCY = 6;

const LEAD_STATUS_SET = new Set<string>(LEAD_STATUSES);

// Statuses a human actually chooses. DEFAULT and INBOUND are set by Leadbay
// itself (a fresh lead / an inbound signal) — accepted on the wire, but never
// offered as a choice. Exported so the artifact runtime and tests share one list.
export const SETTABLE_LEAD_STATUSES = ["WANTED", "WON", "LOST", "UNWANTED"] as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface SetLeadStatusParams {
  lead_ids: string[];
  status: string;
  status_date?: string;
}

interface FailedLead {
  lead_id: string;
  message: string;
}

function messageOf(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as Error).message);
  return String(e);
}

// Fan out with a bounded worker pool, preserving each lead's own failure rather
// than aborting the batch — a partial write must be reportable, not silent.
async function writeAll(
  client: LeadbayClient,
  leadIds: string[],
  status: string,
  statusDate: string | undefined,
): Promise<FailedLead[]> {
  const failed: FailedLead[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = cursor++;
      if (i >= leadIds.length) return;
      const id = leadIds[i];
      try {
        await client.requestVoid("POST", statusPath(id), statusBody(status));
        if (statusDate) {
          await client.requestVoid("POST", statusDatePath(id), statusDateBody(statusDate));
        }
      } catch (e) {
        failed.push({ lead_id: id, message: messageOf(e) });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, leadIds.length) }, () => worker()),
  );
  return failed;
}

export const setLeadStatus: Tool<SetLeadStatusParams> = {
  name: "leadbay_set_lead_status",
  annotations: {
    title: "Set lead CRM status",
    readOnlyHint: false,
    // Org-wide and overwrites whatever the last rep set — destructive in the
    // MCP sense (not reversible from the value we replaced).
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: SET_LEAD_STATUS_DESCRIPTION,
  optional: true,
  write: true,
  inputSchema: {
    type: "object",
    properties: {
      lead_ids: {
        type: "array",
        items: { type: "string" },
        description: `Lead UUIDs (1-${MAX_LEADS}). Every lead gets the same status.`,
      },
      status: {
        type: "string",
        description:
          "One of: WANTED, WON, LOST, UNWANTED (case-insensitive). DEFAULT and INBOUND are accepted but are normally set by Leadbay itself.",
      },
      status_date: {
        type: "string",
        description:
          "Optional YYYY-MM-DD — the date the status was actually reached (close date). Omit to let the backend stamp now.",
      },
    },
    required: ["lead_ids", "status"],
    additionalProperties: false,
  },
  execute: async (client: LeadbayClient, params: SetLeadStatusParams) => {
    const leadIds = (params.lead_ids ?? []).filter(
      (id) => typeof id === "string" && id.trim() !== "",
    );
    if (leadIds.length === 0) {
      return {
        error: true,
        code: "BAD_INPUT",
        message: "lead_ids is empty",
        hint: "Pass at least one lead UUID.",
      };
    }
    if (leadIds.length > MAX_LEADS) {
      return {
        error: true,
        code: "BAD_INPUT",
        message: `lead_ids has ${leadIds.length} entries, max is ${MAX_LEADS}`,
        hint: `Call leadbay_set_lead_status again per chunk of ${MAX_LEADS} lead_ids or fewer.`,
      };
    }

    // Case-insensitive canonicalization only — no synonym guessing. "closed-won"
    // and "dead" fail loudly here instead of as an opaque backend 400.
    const status = String(params.status ?? "").trim().toUpperCase();
    if (!LEAD_STATUS_SET.has(status)) {
      return {
        error: true,
        code: "BAD_INPUT",
        message: `Unknown lead status: ${JSON.stringify(params.status)}`,
        hint: `Use one of ${SETTABLE_LEAD_STATUSES.join(", ")} (case-insensitive).`,
      };
    }

    const statusDate = params.status_date?.trim() || undefined;
    if (statusDate && !ISO_DATE.test(statusDate)) {
      return {
        error: true,
        code: "BAD_INPUT",
        message: `status_date ${JSON.stringify(params.status_date)} is not YYYY-MM-DD`,
        hint: "Pass a calendar date like 2026-03-14, or omit it to stamp now.",
      };
    }

    const failed = await writeAll(client, leadIds, status, statusDate);
    const count = leadIds.length - failed.length;

    return {
      applied: count > 0,
      count,
      status,
      ...(statusDate ? { status_date: statusDate } : {}),
      failed,
    };
  },
};
