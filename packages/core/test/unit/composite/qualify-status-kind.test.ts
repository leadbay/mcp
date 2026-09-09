/**
 * leadbay_qualify_status checks WHAT the notification is, and never dead-ends
 * a caller who also passed lead_ids (leadbay/product#4005 follow-up, found
 * live on staging 2026-09-02).
 *
 *  - An enrichment's notification fed to this tool was reported as a running
 *    qualification. Now it is refused and routed to leadbay_bulk_enrich_status.
 *  - A notification that is not found used to throw even when the caller had
 *    passed lead_ids + lens_id — the fallback the error message itself
 *    recommends. Now it falls through to the per-lead path.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory, getHttpRequests } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { qualifyStatus } from "../../../src/composite/qualify-status.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");
const NOTIF = "5faed710-a0a4-469a-aaaa-444b2b1e93d9";

const listing = (items: unknown[]) => ({
  method: "GET" as const,
  path: /^\/1\.6\/notifications/,
  status: 200,
  body: { items, total_unseen: 0, pagination: { page: 0, pages: 1, count: items.length } },
});

beforeEach(() => resetHttpMock());

describe("leadbay_qualify_status — notification kind + fallback", () => {
  it("refuses a contact-enrichment notification and points at bulk_enrich_status", async () => {
    // Exactly the row staging returned for an enrich_titles launch.
    mockHttp([
      listing([
        {
          id: NOTIF,
          created_at: "2026-09-02T01:20:22Z",
          updated_at: "2026-09-02T01:21:38Z",
          first_seen_at: null,
          archived: false,
          language: "en",
          title: "9 out of 10 contacts have been successfully enriched.",
          content: null,
          in_progress: false,
          links: [{ type: "bulk_enrichment", id: "29" }],
          bulk_progress: null,
          file_import_id: null,
        },
      ]),
    ]);
    await expect(
      qualifyStatus.execute(newClient(), { notification_id: NOTIF }, {})
    ).rejects.toMatchObject({ code: "QUALIFY_JOB_WRONG_KIND" });
  });

  it("a notification that is not found still answers when lead_ids + lens_id were passed", async () => {
    mockHttp([
      // The by-id scan: unarchived, then archived — both empty.
      listing([]),
      listing([]),
      {
        method: "GET",
        path: "/1.6/leads/lead-1/web_fetch",
        status: 200,
        body: {
          lead_id: "lead-1",
          in_progress: false,
          fetch_at: "2026-05-04T00:00:00Z",
          content: { "🏢 company": [{ source: "site", description: "y" }] },
        },
      },
      {
        method: "GET",
        path: "/1.6/leads/lead-1/ai_agent_responses",
        status: 200,
        body: [
          {
            question: "Are they enterprise?",
            question_created_at: "2026-05-04T00:00:00Z",
            lead_id: "lead-1",
            score: 10,
            response: "yes",
            computed_at: "2026-05-04T00:00:00Z",
          },
        ],
      },
    ]);
    const out = await qualifyStatus.execute(
      newClient(),
      { notification_id: NOTIF, lead_ids: ["lead-1"], lens_id: 4125 },
      {}
    );
    expect(out.qualified).toHaveLength(1);
    expect(out.lead_ids).toEqual(["lead-1"]);
    expect(out.bulk_progress).toBeNull();
    expect(getHttpRequests().some((r: any) => /\/leads\/lead-1\//.test(r.path))).toBe(true);
  });

  it("a notification that is not found and no lead_ids is still a clean not-found", async () => {
    mockHttp([listing([]), listing([])]);
    await expect(
      qualifyStatus.execute(newClient(), { notification_id: NOTIF }, {})
    ).rejects.toMatchObject({ code: "QUALIFY_JOB_NOT_FOUND" });
  });
});
