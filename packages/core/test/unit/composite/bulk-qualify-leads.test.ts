/**
 * Unit tests for leadbay_bulk_qualify_leads async handle mode.
 *
 * The launch path uses the SELECTION-based bulk endpoint
 * (`POST /1.5/leads/selection/web_fetch`) so the backend creates one
 * progress notification per call — see backend/docs/adr/notifications.md
 * §4. We expect: select(leadIds) → bulk web_fetch → clear, with
 * BulkWebFetchResponsePayload.notification_id captured on the tracker
 * record.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
  getHttpRequests,
} from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { bulkQualifyLeads } from "../../../src/composite/bulk-qualify-leads.js";
import { InMemoryBulkStore } from "../../../src/jobs/bulk-store.js";

const BASE = "https://api-us.leadbay.app";

function newClient() {
  return new LeadbayClient(BASE, "u.tok", "us");
}

beforeEach(() => {
  resetHttpMock();
});

describe("leadbay_bulk_qualify_leads", () => {
  it("wait_for_completion=false launches bulk web_fetch via selection and persists notification_id", async () => {
    const tracker = new InMemoryBulkStore();
    const NOTIF_ID = "11111111-2222-4333-8444-555555555555";
    mockHttp([
      {
        method: "POST",
        path: "/1.5/leads/selection/select?leadIds=lead-1&leadIds=lead-2",
        status: 204,
      },
      {
        method: "POST",
        path: "/1.5/leads/selection/web_fetch?force_fetch=false",
        status: 200,
        body: {
          queued: 2,
          skipped: 0,
          queued_ids: ["lead-1", "lead-2"],
          skipped_ids: [],
          notification_id: NOTIF_ID,
        },
      },
      {
        method: "POST",
        path: "/1.5/leads/selection/clear",
        status: 204,
      },
    ]);

    const started = Date.now();
    const out = await bulkQualifyLeads.execute(
      newClient(),
      {
        leadIds: ["lead-1", "lead-2"],
        lensId: 21580,
        wait_for_completion: false,
      },
      { bulkTracker: tracker }
    );

    expect(Date.now() - started).toBeLessThan(5_000);
    expect(out).toMatchObject({
      status: "running",
      handle_id: expect.any(String),
      qualify_id: expect.any(String),
      lead_ids: ["lead-1", "lead-2"],
      launched_count: 2,
      failed: [],
      quota_exceeded: false,
      lens_id: 21580,
      notification_id: NOTIF_ID,
    });
    expect(getHttpRequests().map((r) => `${r.method} ${r.path}`)).toEqual([
      "POST /1.5/leads/selection/select?leadIds=lead-1&leadIds=lead-2",
      "POST /1.5/leads/selection/web_fetch?force_fetch=false",
      "POST /1.5/leads/selection/clear",
    ]);

    const record = await tracker.getQualify(out.qualify_id);
    expect(record?.status).toBe("launched");
    expect(record?.lead_ids).toEqual(["lead-1", "lead-2"]);
    expect(record?.notification_id).toBe(NOTIF_ID);
  });
});
