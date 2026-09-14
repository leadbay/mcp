/**
 * The polling instructions enrich_titles hands the agent must carry the run's
 * SCOPE, not just its ids.
 *
 * `bulk_enrich_status` takes the per-lead path whenever `lead_ids` is present —
 * `notification_id` only adds the job counters. On that path a contact counts as
 * done when `enrichment.done === true`, narrowed by `titles` (which roles this
 * run asked for) and by `email`/`phone` (which channel had to land). Drop those
 * three and the narrowing disappears: a lead whose CFO was email-enriched months
 * ago satisfies a fresh phone-only CEO run, so `all_done` is true on the first
 * poll and the agent reports a finished enrichment that never ran.
 *
 * New file — existing enrich-titles tests are not modified.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { resetLaunchGuard } from "../../../src/jobs/launch-guard.js";
import { LeadbayClient } from "../../../src/client.js";
import { enrichTitles } from "../../../src/composite/enrich-titles.js";

const BASE = "https://api-us.leadbay.app";
const LENS_ID = 7;
const LEAD_A = "lead-a";
const TITLE = "CEO";
const NOTIFICATION_ID = "notif-1";

const newClient = () => new LeadbayClient(BASE, "u.test-token");

const meBody = {
  id: "u",
  email: "a@b.com",
  organization: { id: "org-1", billing: { ai_credits: 10, seats: 1 } },
};
const previewBody = {
  enrichable_contacts: 5,
  title_suggestions: [],
  auto_included_titles: [],
  previously_enriched_titles: [],
};

function flow() {
  return mockHttp([
    { method: "POST", path: /\/leads\/selection\/select/, status: 204 },
    { method: "GET", path: "/1.6/leads/selection/enrichment/job_titles", status: 200, body: [TITLE] },
    { method: "POST", path: "/1.6/leads/selection/enrichment/preview", status: 200, body: previewBody },
    { method: "POST", path: "/1.6/leads/selection/clear", status: 204 },
    { method: "GET", path: "/1.6/users/me", status: 200, body: meBody },
    {
      method: "POST",
      path: "/1.6/leads/selection/enrichment/launch",
      status: 200,
      body: { notification_id: NOTIFICATION_ID },
    },
    { method: "POST", path: "/1.6/leads/selection/clear", status: 204 },
  ]);
}

beforeEach(() => {
  resetHttpMock();
  resetLaunchGuard();
});

describe("enrich_titles — the poll it prescribes carries the run's scope", () => {
  it("names titles, email and phone wherever it names lead_ids", async () => {
    flow();
    const res: any = await enrichTitles.execute(
      newClient(),
      { leadIds: [LEAD_A], lensId: LENS_ID, titles: [TITLE], phone: true },
      {}
    );

    expect(res.notification_id).toBe(NOTIFICATION_ID);

    // Every instruction that tells the agent to poll with lead_ids must also
    // tell it to pass the scope, or the count is computed against the lead's
    // whole contact history instead of this run.
    for (const text of [res.message, res.next_action] as string[]) {
      expect(text).toContain("lead_ids");
      expect(text).toContain("titles");
      expect(text).toContain("email");
      expect(text).toContain("phone");
    }
  });
});
