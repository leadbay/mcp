/**
 * Integration tests for enrich_titles ↔ bulk_enrich_status via InMemoryBulkStore.
 * Covers: happy-path launch + status off the backend's notification_id, the
 * in-process double-launch guard, and partial failures mid-status-poll.
 */

import { resetLaunchGuard } from "../../../src/jobs/launch-guard.js";
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
} from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { enrichTitles } from "../../../src/composite/enrich-titles.js";
import { bulkEnrichStatus } from "../../../src/composite/bulk-enrich-status.js";

const NOTIF_ID = "11d949d5-f4e9-4591-b106-f289b863b298";
const BASE = "https://api-us.leadbay.app";

const LENS_ID = 7;
const LEAD_A = "lead-a";
const LEAD_B = "lead-b";
const TITLE = "CEO";

const meBody = {
  id: "u",
  email: "a@b.com",
  organization: { id: "org-1", billing: { ai_credits: 10 } },
};

const previewBody = {
  enrichable_contacts: 5,
  title_suggestions: [],
  auto_included_titles: [],
  previously_enriched_titles: [],
};

function newClient() {
  return new LeadbayClient(BASE, "u.test-token");
}

beforeEach(() => {
  resetHttpMock();
  resetLaunchGuard();
});

// ─── enrich-titles — happy path: launch returns a backend job id ───────────

describe("enrich_titles + bulk_enrich_status — happy path", () => {
  it("launch returns bulk_id + launched_at; status returns progress per lead", async () => {
    mockHttp([
      // select
      { method: "POST", path: /\/leads\/selection\/select/, status: 204 },
      // job_titles
      {
        method: "GET",
        path: "/1.6/leads/selection/enrichment/job_titles",
        status: 200,
        body: [TITLE],
      },
      // preview
      {
        method: "POST",
        path: "/1.6/leads/selection/enrichment/preview",
        status: 200,
        body: previewBody,
      },
      // launch
      {
        method: "POST",
        path: "/1.6/leads/selection/enrichment/launch",
        status: 200,
        body: { notification_id: NOTIF_ID },
      },
      // clear
      { method: "POST", path: "/1.6/leads/selection/clear", status: 204 },
    ]);

    const launched: any = await enrichTitles.execute(
      newClient(),
      {
        leadIds: [LEAD_A, LEAD_B],
        lensId: LENS_ID,
        titles: [TITLE],
        email: true,
      },
      { }
    );

    expect(launched.mode).toBe("launched");
    expect(launched.notification_id).toBe(NOTIF_ID);
    expect(launched.launched_at).toBeTruthy();

    // Now simulate a status poll. getContacts calls GET org + paid contacts in parallel.
    resetHttpMock();
    mockHttp([
      {
        method: "GET",
        path: /^\/1\.6\/notifications/,
        status: 200,
        body: {
          items: [
            {
              id: NOTIF_ID,
              created_at: "2026-09-01T10:00:00Z",
              in_progress: true,
              links: [{ type: "bulk_enrichment", id: 7 }],
              bulk_progress: { total_count: 2, success_count: 1, failure_count: 0, quota_hit_count: 0 },
              file_import_id: null,
            },
          ],
          total_unseen: 0,
          pagination: { page: 0, pages: 1, count: 1 },
        },
      },
      // LEAD_A contacts
      {
        method: "GET",
        path: /\/leads\/lead-a\/contacts\?IncludeEnriched=true/,
        status: 200,
        body: [
          {
            id: "c1",
            first_name: "Alice",
            last_name: "",
            email: "a@x.com",
            phone_number: null,
            linkedin_page: null,
            job_title: TITLE,
            recommended: true,
            enrichment: { done: true, credits_used: 1 },
          },
        ],
      },
      {
        method: "GET",
        path: /\/leads\/lead-a\/enrich\/contacts\?IncludeEnriched=true/,
        status: 200,
        body: [],
      },
      // LEAD_B contacts — one still in flight.
      {
        method: "GET",
        path: /\/leads\/lead-b\/contacts\?IncludeEnriched=true/,
        status: 200,
        body: [
          {
            id: "c2",
            first_name: "Bob",
            last_name: "",
            email: null,
            phone_number: null,
            linkedin_page: null,
            job_title: TITLE,
            recommended: true,
            enrichment: { done: false },
          },
        ],
      },
      {
        method: "GET",
        path: /\/leads\/lead-b\/enrich\/contacts\?IncludeEnriched=true/,
        status: 200,
        body: [],
      },
    ]);

    const status: any = await bulkEnrichStatus.execute(
      newClient(),
      { notification_id: launched.notification_id, lead_ids: launched.lead_ids },
      { }
    );

    expect(status.status).toBe("launched");
    expect(status.leads).toHaveLength(2);
    expect(status.overall_progress.done).toBe(1);
    expect(status.overall_progress.total).toBe(2);
    expect(status.all_done).toBe(false);
    // include_contacts default is false → contacts array omitted.
    expect(status.leads[0].contacts).toBeUndefined();
  });

  it("include_contacts=true returns the per-lead contact arrays", async () => {
    mockHttp([
      { method: "POST", path: /\/leads\/selection\/select/, status: 204 },
      {
        method: "GET",
        path: "/1.6/leads/selection/enrichment/job_titles",
        status: 200,
        body: [TITLE],
      },
      {
        method: "POST",
        path: "/1.6/leads/selection/enrichment/preview",
        status: 200,
        body: previewBody,
      },
      {
        method: "POST",
        path: "/1.6/leads/selection/enrichment/launch",
        status: 200,
        body: { notification_id: NOTIF_ID },
      },
      { method: "POST", path: "/1.6/leads/selection/clear", status: 204 },
    ]);
    const launched: any = await enrichTitles.execute(
      newClient(),
      { leadIds: [LEAD_A], lensId: LENS_ID, titles: [TITLE] },
      { }
    );
    expect(launched.mode).toBe("launched");

    resetHttpMock();
    mockHttp([
      {
        method: "GET",
        path: /^\/1\.6\/notifications/,
        status: 200,
        body: {
          items: [
            {
              id: NOTIF_ID,
              created_at: "2026-09-01T10:00:00Z",
              in_progress: false,
              links: [{ type: "bulk_enrichment", id: 7 }],
              bulk_progress: { total_count: 2, success_count: 2, failure_count: 0, quota_hit_count: 0 },
              file_import_id: null,
            },
          ],
          total_unseen: 0,
          pagination: { page: 0, pages: 1, count: 1 },
        },
      },
      {
        method: "GET",
        path: /\/leads\/lead-a\/contacts\?IncludeEnriched=true/,
        status: 200,
        body: [
          {
            id: "c1",
            first_name: "A",
            last_name: "",
            email: "x@y.com",
            phone_number: null,
            linkedin_page: null,
            job_title: TITLE,
            recommended: true,
            enrichment: { done: true },
          },
        ],
      },
      {
        method: "GET",
        path: /\/leads\/lead-a\/enrich\/contacts\?IncludeEnriched=true/,
        status: 200,
        body: [],
      },
    ]);
    const status: any = await bulkEnrichStatus.execute(
      newClient(),
      { notification_id: launched.notification_id, lead_ids: launched.lead_ids, include_contacts: true },
      { }
    );
    expect(status.leads[0].contacts).toBeDefined();
    expect(status.leads[0].contacts[0].email).toBe("x@y.com");
    expect(status.all_done).toBe(true);
  });
});

// ─── Reuse short-circuit — no second launch POST ────────────────────────────

describe("enrich_titles reuse short-circuit", () => {
  it("identical launch within window returns already_launched without POSTing /launch", async () => {
    // First call — full happy path.
    mockHttp([
      { method: "POST", path: /\/leads\/selection\/select/, status: 204 },
      {
        method: "GET",
        path: "/1.6/leads/selection/enrichment/job_titles",
        status: 200,
        body: [TITLE],
      },
      {
        method: "POST",
        path: "/1.6/leads/selection/enrichment/preview",
        status: 200,
        body: previewBody,
      },
      {
        method: "POST",
        path: "/1.6/leads/selection/enrichment/launch",
        status: 200,
        body: { notification_id: NOTIF_ID },
      },
      { method: "POST", path: "/1.6/leads/selection/clear", status: 204 },
    ]);
    const first: any = await enrichTitles.execute(
      newClient(),
      { leadIds: [LEAD_A], lensId: LENS_ID, titles: [TITLE] },
      { }
    );
    expect(first.mode).toBe("launched");

    // Second call — identical fingerprint. Should short-circuit after preview;
    // mock only the pre-launch calls + clear. NO /launch.
    resetHttpMock();
    const { requests } = mockHttp([
      { method: "POST", path: /\/leads\/selection\/select/, status: 204 },
      {
        method: "GET",
        path: "/1.6/leads/selection/enrichment/job_titles",
        status: 200,
        body: [TITLE],
      },
      {
        method: "POST",
        path: "/1.6/leads/selection/enrichment/preview",
        status: 200,
        body: previewBody,
      },
      { method: "POST", path: "/1.6/leads/selection/clear", status: 204 },
    ]);
    const second: any = await enrichTitles.execute(
      newClient(),
      { leadIds: [LEAD_A], lensId: LENS_ID, titles: [TITLE] },
      { }
    );
    expect(second.mode).toBe("already_launched");
    expect(second.reused).toBe(true);
    expect(second.notification_id).toBe(first.notification_id);
    // Verify /launch was NOT called.
    const launchCalls = requests.filter((r) =>
      /\/enrichment\/launch/.test(r.path)
    );
    expect(launchCalls).toHaveLength(0);
  });
});

// ─── Failed launch → re-launch allowed ──────────────────────────────────────


// ─── NO_CANDIDATES — guard must run after this check ────────────────────────


// ─── bulk_enrich_status validation + error taxonomy ─────────────────────────


// ─── Partial failure during status poll ─────────────────────────────────────

