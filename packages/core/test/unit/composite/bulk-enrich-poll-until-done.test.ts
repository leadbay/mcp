/**
 * product#3866 — "Wait for tool result in enrichment".
 *
 * The behavior change is prompt-level (the agent must STAY ACTIVE and poll
 * leadbay_bulk_enrich_status until all_done, then report on its own). This test
 * is the deterministic mechanical proof that a polling loop has a terminal
 * condition to exit on: across two sequential status polls, `all_done` flips
 * false → true. Without a reliable flip, "poll until done" would be impossible.
 *
 * Drives the FAST path of bulk_enrich_status (the launched record carries a
 * notification_id, so status reads bulk_progress from a single GET /notifications
 * call). The harness matches scripts first-unconsumed-wins, so two same-path
 * GET /notifications scripts model poll-1 (in_progress) then poll-2 (terminal).
 *
 * Companion coverage: WORKFLOWS.md Workflow 43 (live /eval, agent behavior) and
 * the existing bulk-enrich-flow.test.ts (legacy fan-out path).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { bulkEnrichStatus } from "../../../src/composite/bulk-enrich-status.js";
import { InMemoryBulkStore } from "../../../src/jobs/bulk-store.js";

const BASE = "https://api-us.leadbay.app";
const LENS_ID = 7;
const LEAD_A = "lead-a";
const NOTIF_ID = "notif-1";

function newClient() {
  return new LeadbayClient(BASE, "u.test-token");
}

// A minimal-but-valid notification row. bulk_enrich_status's fast path only
// reads `id`, `in_progress`, and `bulk_progress`; the rest satisfies the type.
function notification(inProgress: boolean, successCount: number) {
  return {
    id: NOTIF_ID,
    created_at: "2026-07-07T00:00:00Z",
    updated_at: "2026-07-07T00:00:00Z",
    first_seen_at: null,
    archived: false,
    language: "en",
    title: "Enrichment",
    content: null,
    in_progress: inProgress,
    links: [{ type: "bulk_enrichment", id: "bulk-x" }],
    bulk_progress: {
      total_count: 2,
      success_count: successCount,
      failure_count: 0,
      quota_hit_count: 0,
    },
    file_import_id: null,
  };
}

function notificationsPage(inProgress: boolean, successCount: number) {
  return {
    items: [notification(inProgress, successCount)],
    total_unseen: inProgress ? 1 : 0,
    pagination: { page: 0, count: 50, total: 1 },
  };
}

async function seedLaunchedRecord() {
  const tracker = new InMemoryBulkStore();
  const { record } = await tracker.findOrCreatePending({
    lead_ids: [LEAD_A],
    titles: ["CEO"],
    email: true,
    phone: false,
    lens_id: LENS_ID,
    selection_source: "explicit",
  });
  // markLaunched stores the notification_id → status uses the fast path.
  await tracker.markLaunched(record.bulk_id, NOTIF_ID);
  return { tracker, bulkId: record.bulk_id };
}

beforeEach(() => {
  resetHttpMock();
});

describe("bulk_enrich_status — fast path polls to completion (product#3866)", () => {
  it("poll 1 reports in-progress: all_done=false, no credits read yet", async () => {
    const { tracker, bulkId } = await seedLaunchedRecord();
    mockHttp([
      {
        method: "GET",
        path: /\/1\.6\/notifications/,
        status: 200,
        body: notificationsPage(true, 1),
      },
    ]);

    const res: any = await bulkEnrichStatus.execute(
      newClient(),
      { bulk_id: bulkId },
      { bulkTracker: tracker }
    );

    expect(res.in_progress).toBe(true);
    expect(res.all_done).toBe(false);
    expect(res.overall_progress.done).toBe(1);
    expect(res.overall_progress.total).toBe(2);
    // Fast path only reads credits once terminal — absent while running.
    expect(res.credits_remaining).toBeUndefined();
  });

  it("poll 2 reports terminal: all_done=true, credits force-read", async () => {
    const { tracker, bulkId } = await seedLaunchedRecord();
    mockHttp([
      {
        method: "GET",
        path: /\/1\.6\/notifications/,
        status: 200,
        body: notificationsPage(false, 2),
      },
      // Terminal fast path force-reads the post-spend balance via GET /users/me.
      {
        method: "GET",
        path: /\/1\.6\/users\/me/,
        status: 200,
        body: { id: "u", organization: { id: "org", billing: { ai_credits: 42 } } },
      },
    ]);

    const res: any = await bulkEnrichStatus.execute(
      newClient(),
      { bulk_id: bulkId, include_contacts: true },
      { bulkTracker: tracker }
    );

    expect(res.all_done).toBe(true);
    expect(res.in_progress).toBe(false);
    expect(res.overall_progress.done).toBe(2);
    expect(res.overall_progress.total).toBe(2);
    expect(res.bulk_progress.success_count).toBe(2);
    expect(res.credits_remaining).toBe(42);
  });

  it("the red/green core: all_done flips false → true across two polls", async () => {
    const { tracker, bulkId } = await seedLaunchedRecord();

    // Poll 1 — still running.
    mockHttp([
      {
        method: "GET",
        path: /\/1\.6\/notifications/,
        status: 200,
        body: notificationsPage(true, 1),
      },
    ]);
    const first: any = await bulkEnrichStatus.execute(
      newClient(),
      { bulk_id: bulkId },
      { bulkTracker: tracker }
    );

    // Poll 2 — terminal.
    resetHttpMock();
    mockHttp([
      {
        method: "GET",
        path: /\/1\.6\/notifications/,
        status: 200,
        body: notificationsPage(false, 2),
      },
      {
        method: "GET",
        path: /\/1\.6\/users\/me/,
        status: 200,
        body: { id: "u", organization: { id: "org", billing: { ai_credits: 40 } } },
      },
    ]);
    const second: any = await bulkEnrichStatus.execute(
      newClient(),
      { bulk_id: bulkId },
      { bulkTracker: tracker }
    );

    // A polling loop has a terminal condition to exit on.
    expect([first.all_done, second.all_done]).toEqual([false, true]);
  });
});
