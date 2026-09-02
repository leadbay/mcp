/**
 * leadbay_bulk_enrich_status reads the backend's job, not a local record
 * (leadbay/product#4005).
 *
 * The handle is the `notification_id` the launch returned. The backend mints
 * it, retains it 30 days and scopes it to the organization, so it resolves from
 * any process on any day — which is what the client-minted handle it replaced
 * could never do.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { bulkEnrichStatus } from "../../../src/composite/bulk-enrich-status.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");
const NOTIF = "11d949d5-f4e9-4591-b106-f289b863b298";
const LEAD_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const notification = (over: Record<string, unknown> = {}) => ({
  id: NOTIF,
  created_at: "2026-09-01T10:00:00Z",
  updated_at: "2026-09-01T10:00:00Z",
  first_seen_at: null,
  archived: false,
  language: "en",
  title: "Enrichment running",
  content: null,
  in_progress: true,
  links: [{ type: "bulk_enrichment", id: 7 }],
  bulk_progress: { total_count: 3, success_count: 1, failure_count: 0, quota_hit_count: 0 },
  file_import_id: null,
  ...over,
});
const listing = (n: unknown) => ({
  method: "GET" as const,
  path: /^\/1\.6\/notifications/,
  status: 200,
  body: { items: [n], total_unseen: 0, pagination: { page: 0, pages: 1, count: 1 } },
});

beforeEach(() => resetHttpMock());

describe("leadbay_bulk_enrich_status — reads the backend job", () => {
  it("reports progress from bulk_progress in ONE call", async () => {
    mockHttp([listing(notification())]);
    const res: any = await bulkEnrichStatus.execute(newClient(), { notification_id: NOTIF });

    expect(res.notification_id).toBe(NOTIF);
    expect(res.overall_progress).toEqual({ done: 1, total: 3, done_ratio: 1 / 3 });
    expect(res.in_progress).toBe(true);
    expect(res.all_done).toBe(false);
    // No per-lead fan-out was needed to answer "how far along".
    expect(res.leads).toEqual([]);
  });

  it("goes all_done when the backend says the job stopped", async () => {
    mockHttp([
      listing(
        notification({
          in_progress: false,
          bulk_progress: { total_count: 3, success_count: 3, failure_count: 0, quota_hit_count: 0 },
        })
      ),
      { method: "GET", path: "/1.6/users/me", status: 200, body: { id: "u", organization: { id: "o" } } },
    ]);
    const res: any = await bulkEnrichStatus.execute(newClient(), { notification_id: NOTIF });

    expect(res.all_done).toBe(true);
    expect(res.status).toBe("complete");
    expect(res.overall_progress.done).toBe(3);
  });

  it("surfaces the quota hint when the backend counted a quota hit", async () => {
    mockHttp([
      listing(
        notification({
          in_progress: false,
          bulk_progress: { total_count: 2, success_count: 1, failure_count: 0, quota_hit_count: 1 },
        })
      ),
      { method: "GET", path: "/1.6/users/me", status: 200, body: { id: "u", organization: { id: "o" } } },
    ]);
    const res: any = await bulkEnrichStatus.execute(newClient(), { notification_id: NOTIF });
    expect(res.quota_hit_hint).toMatch(/quota/i);
  });

  it("fetches per-lead contacts only when asked, using the lead_ids the launch returned", async () => {
    mockHttp([
      listing(notification({ in_progress: false })),
      { method: "GET", path: `/1.6/leads/${LEAD_A}/contacts?IncludeEnriched=true`, status: 200, body: [{ id: "c1", first_name: "A" }] },
      { method: "GET", path: `/1.6/leads/${LEAD_A}/enrich/contacts?IncludeEnriched=true`, status: 200, body: [] },
      { method: "GET", path: "/1.6/users/me", status: 200, body: { id: "u", organization: { id: "o" } } },
    ]);
    const res: any = await bulkEnrichStatus.execute(newClient(), {
      notification_id: NOTIF,
      lead_ids: [LEAD_A],
      include_contacts: true,
    });
    expect(res.leads[0].lead_id).toBe(LEAD_A);
    expect(res.leads[0].contacts).toHaveLength(1);
  });

  it("an unknown notification_id is a clear miss, not a crash", async () => {
    mockHttp([
      {
        method: "GET",
        path: /^\/1\.6\/notifications/,
        status: 200,
        body: { items: [], total_unseen: 0, pagination: { page: 0, pages: 1, count: 0 } },
      },
    ]);
    const res: any = await bulkEnrichStatus.execute(newClient(), { notification_id: NOTIF });
    expect(res.error).toBe(true);
    expect(res.code).toBe("ENRICH_JOB_NOT_FOUND");
    // Says what the lookup actually does, not a retention we never verified.
    expect(res.hint).toMatch(/lead_ids/);
  });
});
