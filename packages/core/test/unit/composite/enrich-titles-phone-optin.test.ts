/**
 * product#3865 — when leadbay_enrich_titles is called with titles but NO explicit
 * channel on an elicitation-capable host, the confirmation prompt must OFFER the
 * phone option (email is the default; the user opts into phone), not silently
 * confirm an email-only run. The elicitation carries an `include_phone` toggle;
 * accepting with it true launches with phone enrichment. New file — existing
 * enrich-titles tests are not modified.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { enrichTitles } from "../../../src/composite/enrich-titles.js";
import { InMemoryBulkStore } from "../../../src/jobs/bulk-store.js";
import type { ToolContext } from "../../../src/types.js";

const BASE = "https://api-us.leadbay.app";
const LENS_ID = 7;
const LEAD_A = "lead-a";
const TITLE = "CEO";

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

const newClient = () => new LeadbayClient(BASE, "u.test-token");

// preview phase → (credits read) → launch phase
function flow() {
  return mockHttp([
    { method: "POST", path: /\/leads\/selection\/select/, status: 204 },
    { method: "GET", path: "/1.6/leads/selection/enrichment/job_titles", status: 200, body: [TITLE] },
    { method: "POST", path: "/1.6/leads/selection/enrichment/preview", status: 200, body: previewBody },
    { method: "POST", path: "/1.6/leads/selection/clear", status: 204 },
    { method: "GET", path: "/1.6/users/me", status: 200, body: meBody },
    // launch phase (fresh lock)
    { method: "POST", path: /\/leads\/selection\/select/, status: 204 },
    { method: "POST", path: "/1.6/leads/selection/enrichment/launch", status: 204 },
    { method: "POST", path: "/1.6/leads/selection/clear", status: 204 },
  ]);
}

beforeEach(() => resetHttpMock());

describe("enrich_titles — no-channel elicitation offers the phone opt-in", () => {
  it("elicit requests an include_phone toggle when phone was not pre-set", async () => {
    flow();
    const elicit = vi.fn(async () => ({ action: "accept" as const, content: { confirm: true } }));
    const ctx: ToolContext = { bulkTracker: new InMemoryBulkStore(), elicit };

    await enrichTitles.execute(
      newClient(),
      { leadIds: [LEAD_A], lensId: LENS_ID, titles: [TITLE] }, // bare — no channel
      ctx
    );

    expect(elicit).toHaveBeenCalledTimes(1);
    const schema = (elicit.mock.calls[0][0] as any).requestedSchema;
    // The phone opt-in is offered.
    expect(schema.properties.include_phone).toBeDefined();
  });

  it("accepting with include_phone:true launches WITH phone", async () => {
    flow();
    const elicit = vi.fn(async () => ({
      action: "accept" as const,
      content: { confirm: true, include_phone: true },
    }));
    const ctx: ToolContext = { bulkTracker: new InMemoryBulkStore(), elicit };

    const res: any = await enrichTitles.execute(
      newClient(),
      { leadIds: [LEAD_A], lensId: LENS_ID, titles: [TITLE] },
      ctx
    );

    expect(res.launched ?? res.mode === "launched" ?? res.mode).toBeTruthy();
    expect(res.phone).toBe(true);
    expect(res.email).toBe(true);
  });

  it("accepting WITHOUT include_phone launches email-only (phone stays off)", async () => {
    flow();
    const elicit = vi.fn(async () => ({ action: "accept" as const, content: { confirm: true } }));
    const ctx: ToolContext = { bulkTracker: new InMemoryBulkStore(), elicit };

    const res: any = await enrichTitles.execute(
      newClient(),
      { leadIds: [LEAD_A], lensId: LENS_ID, titles: [TITLE] },
      ctx
    );

    expect(res.email).toBe(true);
    expect(res.phone).toBe(false);
  });

  it("when phone was explicitly requested, no include_phone toggle is offered", async () => {
    // phone:true is an explicit channel = consent → no elicitation at all.
    // Assert the toggle is not surfaced by confirming elicit isn't consulted.
    flow();
    const elicit = vi.fn(async () => ({ action: "accept" as const, content: { confirm: true } }));
    const ctx: ToolContext = { bulkTracker: new InMemoryBulkStore(), elicit };

    const res: any = await enrichTitles.execute(
      newClient(),
      { leadIds: [LEAD_A], lensId: LENS_ID, titles: [TITLE], phone: true },
      ctx
    );

    // Explicit channel consents directly; elicit not needed.
    expect(elicit).not.toHaveBeenCalled();
    expect(res.phone).toBe(true);
  });
});
