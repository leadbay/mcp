/**
 * Unit tests for leadbay_qualify_status (composite).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
} from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { qualifyStatus } from "../../../src/composite/qualify-status.js";
import { InMemoryBulkStore } from "../../../src/jobs/bulk-store.js";

const BASE = "https://api-us.leadbay.app";

function newClient() {
  return new LeadbayClient(BASE, "u.tok", "us");
}

beforeEach(() => {
  resetHttpMock();
});

describe("leadbay_qualify_status — preflight errors", () => {
  it("malformed qualify_id → BULK_INVALID_ID", async () => {
    const tracker = new InMemoryBulkStore();
    await expect(
      qualifyStatus.execute(newClient(), { qualify_id: "not-a-uuid" }, { bulkTracker: tracker })
    ).rejects.toMatchObject({ code: "BULK_INVALID_ID" });
  });

  it("missing bulkTracker → BULK_TRACKER_UNAVAILABLE", async () => {
    await expect(
      qualifyStatus.execute(
        newClient(),
        { qualify_id: "11111111-1111-4111-8111-111111111111" },
        {}
      )
    ).rejects.toMatchObject({ code: "BULK_TRACKER_UNAVAILABLE" });
  });

  it("non-existent qualify_id → BULK_NOT_FOUND", async () => {
    const tracker = new InMemoryBulkStore();
    await expect(
      qualifyStatus.execute(
        newClient(),
        { qualify_id: "11111111-1111-4111-8111-111111111111" },
        { bulkTracker: tracker }
      )
    ).rejects.toMatchObject({ code: "BULK_NOT_FOUND" });
  });

  it("wrong-kind id (an enrich record) → BULK_WRONG_KIND", async () => {
    const tracker = new InMemoryBulkStore();
    const { record } = await tracker.findOrCreatePending({
      lead_ids: ["l-a"],
      titles: [],
      email: false,
      phone: false,
      lens_id: 42,
      selection_source: "explicit",
    });
    await expect(
      qualifyStatus.execute(newClient(), { qualify_id: record.bulk_id }, { bulkTracker: tracker })
    ).rejects.toMatchObject({ code: "BULK_WRONG_KIND" });
  });

  it("pending qualify record → BULK_PENDING", async () => {
    const tracker = new InMemoryBulkStore();
    const { record } = await tracker.findOrCreatePendingQualify({
      lead_ids: ["lead-1"],
      import_ids: ["imp-1"],
      lens_id: 21580,
      mapping_fingerprint: "x",
    });
    await expect(
      qualifyStatus.execute(newClient(), { qualify_id: record.bulk_id }, { bulkTracker: tracker })
    ).rejects.toMatchObject({ code: "BULK_PENDING" });
  });

  it("failed qualify record → BULK_LAUNCH_FAILED", async () => {
    const tracker = new InMemoryBulkStore();
    const { record } = await tracker.findOrCreatePendingQualify({
      lead_ids: ["lead-1"],
      import_ids: ["imp-1"],
      lens_id: 21580,
      mapping_fingerprint: "x",
    });
    await tracker.markFailed(record.bulk_id);
    await expect(
      qualifyStatus.execute(newClient(), { qualify_id: record.bulk_id }, { bulkTracker: tracker })
    ).rejects.toMatchObject({ code: "BULK_LAUNCH_FAILED" });
  });
});

describe("leadbay_qualify_status — happy path", () => {
  it("returns same shape as composite for a launched record", async () => {
    const tracker = new InMemoryBulkStore();
    const { record } = await tracker.findOrCreatePendingQualify({
      lead_ids: ["lead-1"],
      import_ids: ["imp-1"],
      lens_id: 21580,
      mapping_fingerprint: "x",
      per_lead_budget_ms: 30_000,
      total_budget_ms: 60_000,
    });
    await tracker.markLaunched(record.bulk_id);

    mockHttp([
      {
        method: "GET",
        path: "/1.5/leads/lead-1/web_fetch",
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
        path: "/1.5/leads/lead-1/ai_agent_responses",
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
      { qualify_id: record.bulk_id },
      { bulkTracker: tracker }
    );
    expect(out.qualify_id).toBe(record.bulk_id);
    expect(out.status).toBe("launched");
    expect(out.import_ids).toEqual(["imp-1"]);
    expect(out.lead_ids).toEqual(["lead-1"]);
    expect(out.qualified).toHaveLength(1);
    expect(out.qualified[0].qualifications).toHaveLength(1);
    expect(out.still_running).toEqual([]);
    expect(out.per_lead_budget_ms).toBe(30_000);
    expect(out.total_budget_ms).toBe(60_000);
  });

  it("surfaces failed[] when both /web_fetch and /ai_agent_responses 404", async () => {
    const tracker = new InMemoryBulkStore();
    const { record } = await tracker.findOrCreatePendingQualify({
      lead_ids: ["lead-gone"],
      import_ids: ["imp-1"],
      lens_id: 21580,
      mapping_fingerprint: "x",
    });
    await tracker.markLaunched(record.bulk_id);

    mockHttp([
      { method: "GET", path: "/1.5/leads/lead-gone/web_fetch", status: 404 },
      { method: "GET", path: "/1.5/leads/lead-gone/ai_agent_responses", status: 404 },
    ]);

    const out = await qualifyStatus.execute(
      newClient(),
      { qualify_id: record.bulk_id },
      { bulkTracker: tracker }
    );
    expect(out.qualified).toEqual([]);
    expect(out.still_running).toEqual([]);
    expect(out.failed).toEqual([{ lead_id: "lead-gone", error: "NOT_FOUND" }]);
  });

  it("surfaces still_running for in-flight leads", async () => {
    const tracker = new InMemoryBulkStore();
    const { record } = await tracker.findOrCreatePendingQualify({
      lead_ids: ["lead-1"],
      import_ids: ["imp-1"],
      lens_id: 21580,
      mapping_fingerprint: "x",
    });
    await tracker.markLaunched(record.bulk_id);

    mockHttp([
      {
        method: "GET",
        path: "/1.5/leads/lead-1/web_fetch",
        status: 200,
        body: {
          lead_id: "lead-1",
          in_progress: true,
          fetch_at: null,
          content: null,
        },
      },
      {
        method: "GET",
        path: "/1.5/leads/lead-1/ai_agent_responses",
        status: 200,
        body: [],
      },
    ]);

    const out = await qualifyStatus.execute(
      newClient(),
      { qualify_id: record.bulk_id },
      { bulkTracker: tracker }
    );
    expect(out.qualified).toEqual([]);
    expect(out.still_running).toEqual([{ lead_id: "lead-1" }]);
  });
});
