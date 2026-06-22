import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext } from "../types.js";

import { leadbay_team_activity as TEAM_ACTIVITY_DESCRIPTION } from "../tool-descriptions.generated.js";

// Manager / team KPIs — the data behind the web app's Dashboard-Manager screen,
// exposed to the MCP so an artifact can render a team dashboard (top performers +
// activity-over-time). Wraps two backend reads:
//   GET /1.5/kpi/users   → per-rep activity leaderboard (List<UserKpiPayload>)
//   GET /1.5/kpi/trends   → activity time series (List<{date,count}>)
// Both take from/to/periodicity (required) + user_ids; user_events/lead_events
// are optional (the backend defaults to a sensible interaction set). user_ids=ALL
// returns the whole org for admins; non-admins are scoped to themselves by the
// backend. No org id in the path — the oauth token carries org context.

type Periodicity = "DAILY" | "WEEKLY";

export interface TeamActivityParams {
  /** Look-back window in weeks (default 4). Ignored if `from`/`to` are given. */
  weeks?: number;
  /** Explicit ISO date (YYYY-MM-DD) range; overrides `weeks`. */
  from?: string;
  to?: string;
  periodicity?: Periodicity;
  /** Specific rep user-ids; omit for the whole team (ALL). */
  user_ids?: string[];
}

// Raw backend shape (snake_case JSON — what the web dashboard consumes).
interface RawUserKpi {
  user: { id: string; name: string; email: string; manager?: boolean; admin?: boolean };
  total_activities?: number;
  likes?: number;
  saves?: number;
  website?: number;
  exported?: number;
  lead_profile_views?: number;
  create_lead_contact?: number;
  purchase_lead_contact?: number;
  create_lead_note?: number;
  epilogue_interest_validated_or_meeting_planed?: number;
  epilogue_could_not_reach_still_trying?: number;
  epilogue_not_interested_lost?: number;
  epilogue_still_chasing?: number;
}

const DAY_MS = 86_400_000;
const ymd = (d: Date): string => d.toISOString().slice(0, 10);

function mapRep(r: RawUserKpi) {
  const n = (v: number | undefined) => v ?? 0;
  return {
    user_id: r.user?.id,
    name: r.user?.name ?? null,
    email: r.user?.email ?? null,
    total_activities: n(r.total_activities),
    likes: n(r.likes),
    saves: n(r.saves),
    website_clicks: n(r.website),
    exported: n(r.exported),
    profile_views: n(r.lead_profile_views),
    contacts_added: n(r.create_lead_contact),
    contacts_purchased: n(r.purchase_lead_contact),
    notes: n(r.create_lead_note),
    // Epilogue outcomes logged in the window — the "deals" signal.
    meetings_or_interest: n(r.epilogue_interest_validated_or_meeting_planed),
    could_not_reach: n(r.epilogue_could_not_reach_still_trying),
    lost: n(r.epilogue_not_interested_lost),
    still_chasing: n(r.epilogue_still_chasing),
  };
}

export const teamActivity: Tool<TeamActivityParams> = {
  name: "leadbay_team_activity",
  annotations: {
    title: "Team activity + per-rep KPIs",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: TEAM_ACTIVITY_DESCRIPTION,
  write: false,
  inputSchema: {
    type: "object",
    properties: {
      weeks: { type: "number", description: "Look-back window in weeks (default 4). Ignored if from/to given." },
      from: { type: "string", description: "ISO date YYYY-MM-DD (start). Overrides weeks." },
      to: { type: "string", description: "ISO date YYYY-MM-DD (end). Overrides weeks." },
      periodicity: { type: "string", enum: ["DAILY", "WEEKLY"], description: "Trend bucketing (default WEEKLY)." },
      user_ids: {
        type: "array",
        items: { type: "string" },
        description: "Specific rep user-ids; omit for the whole team.",
      },
    },
    additionalProperties: false,
  },
  execute: async (client: LeadbayClient, params: TeamActivityParams, _ctx?: ToolContext) => {
    const periodicity: Periodicity = params.periodicity ?? "WEEKLY";
    const to = params.to ?? ymd(new Date());
    const from =
      params.from ?? ymd(new Date(Date.parse(to) - Math.max(1, params.weeks ?? 4) * 7 * DAY_MS));

    const ids =
      params.user_ids && params.user_ids.length > 0 ? params.user_ids.join(",") : "ALL";
    const qs = `from=${from}&to=${to}&periodicity=${periodicity}&user_ids=${encodeURIComponent(ids)}`;

    const [usersRaw, trendRaw] = await Promise.all([
      client.request<RawUserKpi[]>("GET", `/kpi/users?${qs}`),
      client.request<Array<{ date: string; count: number }>>("GET", `/kpi/trends?${qs}`),
    ]);

    const reps = (usersRaw ?? [])
      .map(mapRep)
      .sort((a, b) => b.total_activities - a.total_activities);

    return {
      range: { from, to, periodicity },
      reps,
      trend: (trendRaw ?? []).map((t) => ({ date: t.date, count: t.count ?? 0 })),
      _meta: { region: client.region },
    };
  },
};
