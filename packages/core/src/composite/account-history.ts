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
  lensId?: number;
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
  outputSchema: {
    type: "object",
    properties: {
      lead: {
        type: "object",
        description: "Which account this history is about.",
        properties: {
          id: { type: "string" },
          name: { type: ["string", "null"] },
        },
        required: ["id"],
      },
      signals: {
        // An ARRAY of priority-ordered sections, matching what
        // research_lead_by_id's own outputSchema declares — this is its payload
        // passed straight through. Null when the research call has no web-fetch
        // content to reshape.
        type: ["array", "null"],
        description: "Live signals, verbatim from leadbay_research_lead_by_id — why this account is hot NOW.",
      },
      firmographics: { type: ["object", "null"], description: "Company facts, verbatim from research." },
      qualification: { type: "array", description: "Per-question qualification answers, verbatim from research." },
      contacts: { type: ["object", "null"], description: "Reachable contacts + candidates, verbatim from research." },
      engagement: { type: ["object", "null"], description: "Engagement counters, verbatim from research." },
      notes: {
        type: "array",
        description: "FULL note bodies — the part research only counts. Oldest first.",
      },
      activities: {
        type: "object",
        description: "The interaction timeline research only summarizes.",
        properties: {
          activities: {
            type: "array",
            description: "One entry per logged interaction.",
            items: {
              type: "object",
              properties: {
                type: { type: "string" },
                date: { type: "string" },
              },
            },
          },
          total: {
            type: "number",
            description: "Total on the server, which can exceed the number returned.",
          },
        },
        required: ["activities", "total"],
      },
      _meta: {
        type: "object",
        description:
          "Research's pass-through metadata (lens_id, web_fetch_in_progress, " +
          "has_reachable_contact, …) plus region and this call's counts.",
      },
    },
    required: ["lead", "notes", "activities"],
  },
  inputSchema: {
    type: "object",
    properties: {
      leadId: { type: "string", description: "Lead UUID (required)" },
      activityCount: {
        type: "number",
        description:
          "Number of activity-timeline entries to return, max 100 (default: 50).",
      },
      lensId: {
        type: "number",
        description:
          "Lens id the lead came from (escape hatch — normally omit; defaults to the active lens). Pass it when researching a lead from a lens other than the current default, so the underlying /lenses/{lensId}/leads/{leadId} fetch doesn't 404 after the active lens changed.",
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
      researchLeadById.execute(
        client,
        { leadId, lensId: params.lensId, response_format: "json" },
        ctx
      ),
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
      // Preserve research's pass-through metadata (agent_memory summary,
      // lens_id, web_fetch_in_progress, has_reachable_contact, …) — the
      // generated description advertises the memory protocol, so dropping
      // _meta.agent_memory would make history narratives miss stored
      // preferences. Spread research _meta first, then layer our counts.
      _meta: {
        ...(r._meta ?? {}),
        region: client.region,
        notes_count: noteList.length,
        activities_returned: activityItems.length,
      },
    };
  },
};
