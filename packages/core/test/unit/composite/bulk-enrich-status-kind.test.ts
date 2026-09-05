/**
 * leadbay_bulk_enrich_status checks WHAT the notification is before reading
 * its counters (leadbay/product#4005 follow-up, found live on staging
 * 2026-09-02).
 *
 *  - A qualification's notification also carries `bulk_progress`; fed to this
 *    tool it was reported as a finished enrichment. Now it is refused and
 *    routed to leadbay_qualify_status.
 *  - An enrichment notification on the live backend carried NO
 *    `bulk_progress` at all (only `in_progress` + a title + the
 *    `bulk_enrichment` link), so the counters-only path said "not a bulk job".
 *    Now it says what the backend knows and asks for `lead_ids`.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { bulkEnrichStatus } from "../../../src/composite/bulk-enrich-status.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");
const NOTIF = "203937fd-7c80-4b3c-88c1-1c0ac44f67b6";

const base = {
  id: NOTIF,
  created_at: "2026-09-02T01:14:30Z",
  updated_at: "2026-09-02T01:16:35Z",
  first_seen_at: null,
  archived: false,
  language: "en",
  content: null,
  file_import_id: null,
};
const listing = (n: unknown) => ({
  method: "GET" as const,
  path: /^\/1\.6\/notifications/,
  status: 200,
  body: { items: [n], total_unseen: 0, pagination: { page: 0, pages: 1, count: 1 } },
});

beforeEach(() => resetHttpMock());

describe("leadbay_bulk_enrich_status — notification kind", () => {
  it("refuses a lead-qualification notification and points at qualify_status", async () => {
    // Exactly the row staging returned for a bulk_qualify_leads launch: no
    // links, counters present, title about rescoring.
    mockHttp([
      listing({
        ...base,
        title: "AI rescore complete for 2/2 leads.",
        in_progress: false,
        links: [],
        bulk_progress: { total_count: 2, success_count: 2, failure_count: 0, quota_hit_count: 0 },
      }),
    ]);
    const res: any = await bulkEnrichStatus.execute(newClient(), { notification_id: NOTIF });
    expect(res.error).toBe(true);
    expect(res.code).toBe("ENRICH_JOB_WRONG_KIND");
    expect(res.hint).toContain("leadbay_qualify_status");
    expect(res.all_done).toBeUndefined();
  });

  it("refuses an import notification and points at import_status", async () => {
    mockHttp([
      listing({
        ...base,
        title: "Import complete: 1 of 2 rows imported.",
        in_progress: false,
        links: [],
        file_import_id: "78857bd4-c67f-45bf-9c4c-c56d8523e2fd",
        bulk_progress: { total_count: 2, success_count: 1, failure_count: 1, quota_hit_count: 0 },
      }),
    ]);
    const res: any = await bulkEnrichStatus.execute(newClient(), { notification_id: NOTIF });
    expect(res.code).toBe("ENRICH_JOB_WRONG_KIND");
    expect(res.hint).toContain("leadbay_import_status");
  });

  it("an enrichment notification without counters says so and asks for lead_ids", async () => {
    // The row staging returned for a finished enrich_titles launch.
    mockHttp([
      listing({
        ...base,
        title: "9 out of 10 contacts have been successfully enriched.",
        in_progress: false,
        links: [{ type: "bulk_enrichment", id: "29" }],
        bulk_progress: null,
      }),
    ]);
    const res: any = await bulkEnrichStatus.execute(newClient(), { notification_id: NOTIF });
    expect(res.error).toBe(true);
    expect(res.code).toBe("ENRICH_JOB_NO_COUNTERS");
    expect(res.in_progress).toBe(false);
    expect(res.message).toContain("finished");
    expect(res.hint).toContain("lead_ids");
  });
});
