import type { LeadbayClient } from "../client.js";
import type {
  Tool,
  ToolContext,
  NotePayload,
  PaginatedActivities,
} from "../types.js";
import { researchLeadById } from "./research-lead-by-id.js";

import { leadbay_account_history as ACCOUNT_HISTORY_DESCRIPTION } from "../tool-descriptions.generated.js";

export interface AccountHistoryParams {
  leadId: string;
  activityCount?: number;
}

// research_lead_by_id returns a rich structured object (firmographics,
// signals, qualification, a SUMMARIZED recent_activities slice, and
// notes_count — but NOT the note bodies). leadbay_account_history layers the
// FULL notes list + FULL activity timeline on top so the agent can write the
// US4 "why has this account resurfaced" narrative in one call. See #3630.
export const accountHistory: Tool<AccountHistoryParams> = {
  name: "leadbay_account_history",
  annotations: {
    title: "One account's full back-story",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: ACCOUNT_HISTORY_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      leadId: { type: "string", description: "Lead UUID (required)" },
      activityCount: {
        type: "number",
        description:
          "Number of activity-timeline entries to return, max 100 (default: 50).",
      },
    },
    required: ["leadId"],
    additionalProperties: false,
  },
  execute: async (
    client: LeadbayClient,
    params: AccountHistoryParams,
    ctx?: ToolContext
  ) => {
    const leadId = params.leadId;
    // Clamp both ends: upper to the backend max, lower to 1 so a 0/negative/
    // NaN activityCount can't produce a degenerate `?count=` the backend may
    // 4xx on (which .catch would silently flatten into "no activity").
    const count = Math.max(1, Math.min(Math.floor(params.activityCount ?? 50), 100));

    // research is load-bearing — if it throws, the whole card fails (the
    // agent has nothing to narrate). notes + activities degrade gracefully:
    // a missing history section must not sink the signals block.
    const [research, notes, activities] = await Promise.all([
      researchLeadById.execute(client, { leadId, response_format: "json" }, ctx),
      client
        .request<NotePayload[]>("GET", `/leads/${leadId}/notes`)
        .catch(() => [] as NotePayload[]),
      client
        .request<PaginatedActivities>(
          "GET",
          `/leads/${leadId}/activities?count=${count}`
        )
        .catch(
          () =>
            ({ items: [], pagination: { total: 0 } } as unknown as PaginatedActivities)
        ),
    ]);

    const r = research as Record<string, any>;

    // The .catch() above only fires on a REJECTED request. A 200 with a
    // malformed body (null, {}, items:null — truncation, proxy stub, partial
    // backend) flows past it, so guard the shapes here before mapping. This is
    // what actually delivers the "degrade gracefully" promise; without it a
    // single malformed-but-200 response would throw uncaught and sink the card.
    const noteList: NotePayload[] = Array.isArray(notes) ? notes : [];
    const activityItems = Array.isArray(activities?.items) ? activities.items : [];

    return {
      lead: {
        id: r.firmographics?.id ?? leadId,
        name: r.firmographics?.name ?? null,
      },
      // Current state — signals, firmographics, qualification, contacts,
      // engagement: passed through verbatim from research_lead_by_id so the
      // agent gets the live "why is this account hot NOW" picture.
      signals: r.signals ?? null,
      firmographics: r.firmographics ?? null,
      qualification: r.qualification ?? [],
      contacts: r.contacts ?? null,
      engagement: r.engagement ?? null,
      // Historical context — the part research only counts/summarizes.
      notes: noteList,
      activities: {
        activities: activityItems.map((a) => ({ type: a.type, date: a.date })),
        total: activities?.pagination?.total ?? 0,
      },
      _meta: {
        region: client.region,
        notes_count: noteList.length,
        activities_returned: activityItems.length,
      },
    };
  },
};
