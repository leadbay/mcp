/**
 * product#4175 Case 4 — a daily job re-attempted an enrichment that was already done.
 *
 * The preview for three leads answered `enrichable_contacts: 0,
 * enriched_contacts: 10`: every contact with those titles had already been
 * enriched. The result said "No enrichable contacts for the chosen titles. Try
 * other titles from available_titles or recommendations." and never showed the
 * 10. A scheduled job read that on 28 of 30 days, retried once with every title
 * in available_titles, got the same answer, and came back the next day.
 *
 * When the contacts are already enriched, the result says so, carries the
 * count, and does not send the agent to try again. When no contact has the
 * titles at all, the old advice to try other titles stays.
 */

import { resetLaunchGuard } from "../../../src/jobs/launch-guard.js";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { enrichTitles } from "../../../src/composite/enrich-titles.js";

const BASE = "https://api-fr.leadbay.app";
const LEADS = ["lead-1", "lead-2", "lead-3"];
const TITLES = ["Directeur Général", "Président", "General Manager"];

function previewFlow(preview: { enriched_contacts: number; enrichable_contacts: number }) {
  return mockHttp([
    { method: "POST", path: /\/leads\/selection\/select/, status: 204 },
    { method: "GET", path: "/1.6/leads/selection/enrichment/job_titles", status: 200, body: TITLES },
    {
      method: "POST",
      path: "/1.6/leads/selection/enrichment/preview",
      status: 200,
      body: { selected_leads: 3, title_suggestions: [], ...preview },
    },
    { method: "POST", path: "/1.6/leads/selection/clear", status: 204 },
    {
      method: "GET",
      path: "/1.6/users/me",
      status: 200,
      body: { id: "u", organization: { id: "o", billing: { ai_credits: 10 } } },
    },
  ]);
}

const run = () =>
  enrichTitles.execute(new LeadbayClient(BASE, "u.test-token", "fr"), {
    leadIds: LEADS,
    lensId: 7,
    titles: TITLES,
    email: true,
  }) as Promise<any>;

beforeEach(() => {
  resetHttpMock();
  resetLaunchGuard();
});

describe("enrich_titles when every matching contact is already enriched (product#4175)", () => {
  it("says the contacts are already enriched, with the count, and does not send the agent to retry", async () => {
    const { requests } = previewFlow({ enriched_contacts: 10, enrichable_contacts: 0 });
    const res = await run();

    expect(res.mode).toBe("preview_only");
    expect(res.launched).toBe(false);
    expect(res.already_enriched_contacts).toBe(10);
    expect(res.message).toMatch(/all 10 contacts/i);
    expect(res.message).toContain("already enriched");
    expect(res.message).toContain("same answer");
    expect(res.message).not.toMatch(/try other titles/i);
    expect(requests.filter((r) => /\/enrichment\/launch/.test(r.path))).toHaveLength(0);
  });

  it("keeps the advice to try other titles when no contact has these titles", async () => {
    previewFlow({ enriched_contacts: 0, enrichable_contacts: 0 });
    const res = await run();

    expect(res.mode).toBe("preview_only");
    expect(res.already_enriched_contacts).toBe(0);
    expect(res.message).toMatch(/try other titles/i);
  });
});
