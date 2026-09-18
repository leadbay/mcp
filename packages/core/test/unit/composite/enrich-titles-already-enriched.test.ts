/**
 * leadbay_enrich_titles when every contact with the titles is already enriched
 * (product#4169).
 *
 * The preview's enriched_contacts counts contacts with these titles that
 * already have an enrichment for the org, and enrichable_contacts the ones
 * that do not (PaidContactsDaoImpl.countContacts). With 0 enrichable and 10
 * enriched there is nothing left to reveal, yet the tool answered "Try other
 * titles". A scheduled run for admin@groupeorionis.com did exactly that: on
 * 2026-09-10 it re-called with the eight available_titles and got the same
 * answer, and it repeated the call on 28 of 30 days for the same three leads.
 */

import { resetLaunchGuard } from "../../../src/jobs/launch-guard.js";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { enrichTitles } from "../../../src/composite/enrich-titles.js";

const BASE = "https://api-fr.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token");

const TITLES = ["Directeur Général", "Président"];

function previewReturning(counts: { enriched_contacts: number; enrichable_contacts: number }) {
  return mockHttp([
    { method: "POST", path: /\/leads\/selection\/select\?/, status: 204 },
    { method: "GET", path: "/1.6/leads/selection/enrichment/job_titles", status: 200, body: TITLES },
    {
      method: "POST",
      path: "/1.6/leads/selection/enrichment/preview",
      status: 200,
      body: { selected_leads: 3, title_suggestions: ["Administrateur"], ...counts },
    },
    { method: "POST", path: "/1.6/leads/selection/clear", status: 204 },
    { method: "GET", path: "/1.6/users/me", status: 200, body: { id: "u", organization: { id: "o", billing: { ai_credits: 0 } } } },
  ]);
}

const call = () =>
  enrichTitles.execute(newClient(), {
    leadIds: ["egis", "faceo", "arcadis"],
    lensId: 1,
    titles: TITLES,
    email: true,
    phone: true,
    confirm: true,
  });

beforeEach(() => {
  resetHttpMock();
  resetLaunchGuard();
});

describe("enrich_titles with nothing left to enrich (product#4169)", () => {
  it("says the contacts are already enriched and does not send the caller to other titles", async () => {
    const { requests } = previewReturning({ enriched_contacts: 10, enrichable_contacts: 0 });

    const res: any = await call();

    expect(res.mode).toBe("preview_only");
    expect(res.launched).toBe(false);
    expect(res.message).toContain("All 10 contacts with these titles on these leads were already enriched");
    expect(res.message).not.toMatch(/try other titles/i);
    expect(res.next_action).toContain("leadbay_research_lead_by_id");
    expect(res.next_action).toContain("Do not call leadbay_enrich_titles again for these leads and titles");
    expect(requests.filter((r) => /enrichment\/launch/.test(r.path))).toHaveLength(0);
  });

  it("still suggests other titles when no contact holds the chosen titles at all", async () => {
    previewReturning({ enriched_contacts: 0, enrichable_contacts: 0 });

    const res: any = await call();

    expect(res.mode).toBe("preview_only");
    expect(res.message).toBe(
      "No enrichable contacts for the chosen titles. Try other titles from available_titles or recommendations."
    );
    expect(res.next_action).toBeUndefined();
  });
});
