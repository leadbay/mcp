/**
 * Credit-cost visibility around enrichment (BEFORE balance/volume, AFTER spend).
 *
 * Covers:
 *  - bulk_enrich_status re-reads credits_remaining once all_done (forced /users/me)
 *    and does NOT report a per-run "credits used" (can't be scoped to this bulk).
 *  - enrich_titles dry_run / discover surface credits_remaining + enrichable_contacts
 *    BEFORE launch (no fabricated cost estimate).
 *  - the readCreditsRemaining helper in isolation.
 *
 * New file (existing test files are never modified).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { enrichTitles } from "../../../src/composite/enrich-titles.js";
import { bulkEnrichStatus } from "../../../src/composite/bulk-enrich-status.js";
import { InMemoryBulkStore } from "../../../src/jobs/bulk-store.js";
import { readCreditsRemaining } from "../../../src/composite/_credits-helpers.js";

const BASE = "https://api-us.leadbay.app";
const LENS_ID = 7;
const LEAD_A = "lead-a";
const LEAD_B = "lead-b";
const TITLE = "CEO";

const previewBody = {
  enrichable_contacts: 5,
  title_suggestions: [],
  auto_included_titles: [],
  previously_enriched_titles: [],
};

const newClient = () => new LeadbayClient(BASE, "u.test-token");

function contact(id: string, enrichment: any) {
  return {
    id,
    first_name: id,
    last_name: "",
    email: `${id}@x.com`,
    phone_number: null,
    linkedin_page: null,
    job_title: TITLE,
    recommended: true,
    enrichment,
  };
}

beforeEach(() => resetHttpMock());

// ─── helper in isolation ────────────────────────────────────────────────────

describe("readCreditsRemaining", () => {
  it("returns ai_credits from billing", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 200,
        body: { id: "u", organization: { id: "org-1", billing: { ai_credits: 42 } } },
      },
    ]);
    expect(await readCreditsRemaining(newClient())).toBe(42);
  });

  it("returns null when billing is absent (older backend) — never crashes", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 200,
        body: { id: "u", organization: { id: "org-1" } },
      },
    ]);
    expect(await readCreditsRemaining(newClient())).toBeNull();
  });

  it("returns null when /users/me fails — advisory, never throws", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 500, body: { message: "boom" } },
    ]);
    expect(await readCreditsRemaining(newClient())).toBeNull();
  });
});

// ─── AFTER: bulk_enrich_status surfaces balance only (no per-run cost) ───────

describe("bulk_enrich_status — credits_remaining only", () => {
  it("re-reads balance when all_done and does NOT report a credits-used figure", async () => {
    const tracker = new InMemoryBulkStore();
    const { record } = await tracker.findOrCreatePending({
      lead_ids: [LEAD_A, LEAD_B],
      titles: [TITLE],
      email: true,
      phone: false,
      lens_id: LENS_ID,
      selection_source: "explicit",
    });
    await tracker.markLaunched(record.bulk_id);

    mockHttp([
      {
        method: "GET",
        path: /\/leads\/lead-a\/contacts\?IncludeEnriched=true/,
        status: 200,
        body: [contact("c1", { done: true, credits_used: 2 })],
      },
      {
        method: "GET",
        path: /\/leads\/lead-a\/enrich\/contacts\?IncludeEnriched=true/,
        status: 200,
        body: [],
      },
      {
        method: "GET",
        path: /\/leads\/lead-b\/contacts\?IncludeEnriched=true/,
        status: 200,
        body: [contact("c2", { done: true, credits_used: 3 })],
      },
      {
        method: "GET",
        path: /\/leads\/lead-b\/enrich\/contacts\?IncludeEnriched=true/,
        status: 200,
        body: [],
      },
      // forced post-spend balance read (all_done → resolveMe(true))
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 200,
        body: { id: "u", organization: { id: "org-1", billing: { ai_credits: 95 } } },
      },
    ]);

    const status: any = await bulkEnrichStatus.execute(
      newClient(),
      { bulk_id: record.bulk_id },
      { bulkTracker: tracker }
    );

    expect(status.all_done).toBe(true);
    expect(status.credits_remaining).toBe(95);
    // No per-run cost figure — would conflate historical enrichments.
    expect(status.credits_used_total).toBeUndefined();
    expect(status.credits_used).toBeUndefined();
  });

  it("does not over-report cost when a lead carries prior-run enriched contacts", async () => {
    // The bug scenario: LEAD_A already has a CFO contact enriched earlier
    // (credits_used: 9). This bulk only ordered the CEO. getContacts returns
    // BOTH. We must NOT surface 9 (or 9+anything) as this run's spend.
    const tracker = new InMemoryBulkStore();
    const { record } = await tracker.findOrCreatePending({
      lead_ids: [LEAD_A],
      titles: [TITLE],
      email: true,
      phone: false,
      lens_id: LENS_ID,
      selection_source: "explicit",
    });
    await tracker.markLaunched(record.bulk_id);

    mockHttp([
      {
        method: "GET",
        path: /\/leads\/lead-a\/contacts\?IncludeEnriched=true/,
        status: 200,
        body: [
          contact("prior-cfo", { done: true, credits_used: 9 }), // earlier run
          contact("this-ceo", { done: true, credits_used: 1 }), // this run
        ],
      },
      {
        method: "GET",
        path: /\/leads\/lead-a\/enrich\/contacts\?IncludeEnriched=true/,
        status: 200,
        body: [],
      },
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 200,
        body: { id: "u", organization: { id: "org-1", billing: { ai_credits: 50 } } },
      },
    ]);

    const status: any = await bulkEnrichStatus.execute(
      newClient(),
      { bulk_id: record.bulk_id },
      { bulkTracker: tracker }
    );

    expect(status.all_done).toBe(true);
    // Balance is the only cost signal; no inflated "10 credits used".
    expect(status.credits_remaining).toBe(50);
    expect(status.credits_used_total).toBeUndefined();
  });
});

// ─── BEFORE: enrich_titles surfaces balance + volume ────────────────────────

describe("enrich_titles BEFORE — balance + volume, no fabricated cost", () => {
  it("dry_run returns credits_remaining + enrichable_contacts; does not launch", async () => {
    const tracker = new InMemoryBulkStore();
    const { requests } = mockHttp([
      { method: "POST", path: /\/leads\/selection\/select/, status: 204 },
      {
        method: "GET",
        path: "/1.5/leads/selection/enrichment/job_titles",
        status: 200,
        body: [TITLE],
      },
      {
        method: "POST",
        path: "/1.5/leads/selection/enrichment/preview",
        status: 200,
        body: previewBody,
      },
      // credits_remaining read (BEFORE — cached resolveMe is fine)
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 200,
        body: { id: "u", organization: { id: "org-1", billing: { ai_credits: 50 } } },
      },
      { method: "POST", path: "/1.5/leads/selection/clear", status: 204 },
    ]);

    const res: any = await enrichTitles.execute(
      newClient(),
      { leadIds: [LEAD_A], lensId: LENS_ID, titles: [TITLE], dry_run: true },
      { bulkTracker: tracker }
    );

    expect(res.mode).toBe("dry_run");
    expect(res.enrichable_contacts).toBe(5);
    expect(res.credits_remaining).toBe(50);
    // no launch on a dry run
    const launchCalls = requests.filter((r) => /\/enrichment\/launch/.test(r.path));
    expect(launchCalls).toHaveLength(0);
  });

  it("discover mode surfaces credits_remaining alongside enrichable_contacts", async () => {
    const tracker = new InMemoryBulkStore();
    mockHttp([
      { method: "POST", path: /\/leads\/selection\/select/, status: 204 },
      {
        method: "GET",
        path: "/1.5/leads/selection/enrichment/job_titles",
        status: 200,
        body: [TITLE],
      },
      {
        method: "POST",
        path: "/1.5/leads/selection/enrichment/preview",
        status: 200,
        body: previewBody,
      },
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 200,
        body: { id: "u", organization: { id: "org-1", billing: { ai_credits: 12 } } },
      },
      { method: "POST", path: "/1.5/leads/selection/clear", status: 204 },
    ]);

    const res: any = await enrichTitles.execute(
      newClient(),
      { leadIds: [LEAD_A], lensId: LENS_ID }, // no titles → discover
      { bulkTracker: tracker }
    );

    expect(res.mode).toBe("discover");
    expect(res.credits_remaining).toBe(12);
    expect(typeof res.enrichable_contacts).toBe("number");
  });

  it("dry_run with billing absent → credits_remaining null, still returns volume", async () => {
    const tracker = new InMemoryBulkStore();
    mockHttp([
      { method: "POST", path: /\/leads\/selection\/select/, status: 204 },
      {
        method: "GET",
        path: "/1.5/leads/selection/enrichment/job_titles",
        status: 200,
        body: [TITLE],
      },
      {
        method: "POST",
        path: "/1.5/leads/selection/enrichment/preview",
        status: 200,
        body: previewBody,
      },
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 200,
        body: { id: "u", organization: { id: "org-1" } }, // no billing
      },
      { method: "POST", path: "/1.5/leads/selection/clear", status: 204 },
    ]);

    const res: any = await enrichTitles.execute(
      newClient(),
      { leadIds: [LEAD_A], lensId: LENS_ID, titles: [TITLE], dry_run: true },
      { bulkTracker: tracker }
    );

    expect(res.mode).toBe("dry_run");
    expect(res.credits_remaining).toBeNull();
    expect(res.enrichable_contacts).toBe(5);
  });
});
