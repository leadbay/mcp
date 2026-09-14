/**
 * account_history must return the REAL timeline, not the degraded one.
 *
 * The tool fans out through research_lead_by_id and then reads notes +
 * activities itself, and both of those reads `.catch()` to empty. That makes a
 * missing mock invisible: the call rejects, the catch swallows it, and the tool
 * returns `notes: []` / `activities: {activities: [], total: 0}` while still
 * being perfectly schema-conformant. The outputSchema conformance case cannot
 * catch it — it asserts shape, not content.
 *
 * research_lead_by_id reads `/activities?count=20` before account_history reads
 * `/activities?count=<n>`, and the harness consumes each script once, so the
 * two need separate mocks. This test pins the distinction by asserting the
 * history actually arrives.
 *
 * New file.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { accountHistory } from "../../../src/composite/account-history.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

const LEAD = {
  id: "lead-1", name: "Acme", sector_id: 7, score: 80, ai_agent_lead_score: 70,
  tags: [], size: null, location: null, website: "acme.com", description: null,
  short_description: null, social: {}, liked: false, disliked: false,
  contacts_count: 0, org_contacts_count: 0, notes_count: 1,
  epilogue_actions_count: 0, prospecting_actions_count: 0,
  recommended_contact_title: null, recommended_contact: null,
};

/** Every endpoint the fan-out touches, in the order the two layers read them. */
function mockFullFanout() {
  mockHttp([
    { method: "POST", path: "/1.6/interactions", status: 200, body: {} },
    { method: "GET", path: /\/1\.6\/lenses\/42\/leads\/lead-1$/, status: 200, body: LEAD },
    { method: "GET", path: "/1.6/leads/lead-1/ai_agent_responses", status: 200, body: [] },
    { method: "GET", path: /\/1\.6\/leads\/lead-1\/enrich\/contacts/, status: 200, body: [] },
    { method: "GET", path: /\/1\.6\/leads\/lead-1\/contacts/, status: 200, body: [] },
    { method: "GET", path: "/1.6/leads/lead-1/web_fetch", status: 200, body: {} },
    // research's own read — must not eat account_history's.
    { method: "GET", path: /\/1\.6\/leads\/lead-1\/activities\?count=20/, status: 200,
      body: { items: [], pagination: { total: 0 } } },
    { method: "GET", path: /\/1\.6\/leads\/lead-1\/notes/, status: 200,
      body: [{ id: "n-1", note: "Met at trade show.", created_at: "2026-05-01T00:00:00Z" }] },
    { method: "GET", path: /\/1\.6\/leads\/lead-1\/activities\?count=5/, status: 200,
      body: { items: [{ type: "LEAD_LIKED", date: "2026-05-02T00:00:00Z" }], pagination: { total: 9 } } },
  ]);
}

beforeEach(() => resetHttpMock());

describe("leadbay_account_history — the history actually arrives", () => {
  it("returns the notes and the timeline, not the swallowed-error empties", async () => {
    mockFullFanout();
    const r: any = await accountHistory.execute(newClient(), {
      leadId: "lead-1", lensId: 42, activityCount: 5,
    });

    expect(r.notes).toHaveLength(1);
    expect(r.activities.activities).toHaveLength(1);
    expect(r.activities.activities[0].type).toBe("LEAD_LIKED");
    // `total` is the server-side count, which exceeds what was returned.
    expect(r.activities.total).toBe(9);
    expect(r._meta.notes_count).toBe(1);
    expect(r._meta.activities_returned).toBe(1);
  });

  it("signals is an array or null — the shape account_history declares", async () => {
    mockFullFanout();
    const r: any = await accountHistory.execute(newClient(), {
      leadId: "lead-1", lensId: 42, activityCount: 5,
    });
    expect(r.signals === null || Array.isArray(r.signals)).toBe(true);
  });
});
