import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory, getHttpRequests } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { teamActivity } from "../../../src/composite/team-activity.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

const USERS = [
  {
    user: { id: "u-anna", name: "Anna", email: "anna@x.co" },
    total_activities: 40,
    likes: 5,
    create_lead_note: 12,
    create_lead_contact: 3,
    epilogue_interest_validated_or_meeting_planed: 4,
    epilogue_not_interested_lost: 2,
  },
  {
    user: { id: "u-ben", name: "Ben", email: "ben@x.co" },
    total_activities: 90,
    likes: 9,
    create_lead_note: 30,
    epilogue_interest_validated_or_meeting_planed: 7,
  },
];
const TREND = [
  { date: "2026-06-01", count: 20 },
  { date: "2026-06-08", count: 35 },
];

describe("leadbay_team_activity", () => {
  it("returns a per-rep leaderboard sorted by activity + a trend series", async () => {
    mockHttp([
      { method: "GET", path: /\/kpi\/users\?/, status: 200, body: USERS },
      { method: "GET", path: /\/kpi\/trends\?/, status: 200, body: TREND },
    ]);
    const res: any = await teamActivity.execute(newClient(), { weeks: 2 });

    // Leaderboard sorted desc by total_activities (Ben before Anna).
    expect(res.reps.map((r: any) => r.name)).toEqual(["Ben", "Anna"]);
    expect(res.reps[0]).toMatchObject({
      user_id: "u-ben",
      total_activities: 90,
      notes: 30,
      meetings_or_interest: 7,
    });
    // Missing counters default to 0.
    expect(res.reps[0].lost).toBe(0);
    expect(res.trend).toEqual(TREND);
    expect(res.range.periodicity).toBe("WEEKLY");
  });

  it("derives a from/to window and requests user_ids=ALL by default", async () => {
    mockHttp([
      { method: "GET", path: /\/kpi\/users\?/, status: 200, body: [] },
      { method: "GET", path: /\/kpi\/trends\?/, status: 200, body: [] },
    ]);
    await teamActivity.execute(newClient(), {});
    const reqs = getHttpRequests();
    expect(reqs).toHaveLength(2);
    expect(reqs[0].path).toMatch(/user_ids=ALL/);
    expect(reqs[0].path).toMatch(/from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/);
    expect(reqs[0].path).toMatch(/periodicity=WEEKLY/);
  });

  it("propagates explicit user_ids + period", async () => {
    mockHttp([
      { method: "GET", path: /\/kpi\/users\?/, status: 200, body: [] },
      { method: "GET", path: /\/kpi\/trends\?/, status: 200, body: [] },
    ]);
    await teamActivity.execute(newClient(), {
      from: "2026-01-01",
      to: "2026-01-31",
      periodicity: "DAILY",
      user_ids: ["u-1", "u-2"],
    });
    const reqs = getHttpRequests();
    expect(reqs[0].path).toMatch(/from=2026-01-01&to=2026-01-31/);
    expect(reqs[0].path).toMatch(/periodicity=DAILY/);
    expect(reqs[0].path).toMatch(/user_ids=u-1%2Cu-2/);
  });
});
