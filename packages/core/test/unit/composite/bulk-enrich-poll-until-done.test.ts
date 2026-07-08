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
import { mockHttp, resetHttpMock, httpsMockFactory, getHttpRequests } from "../../harness.js";

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

  it("poll 2 reports terminal: all_done=true, contacts + credits force-read", async () => {
    const { tracker, bulkId } = await seedLaunchedRecord();
    mockHttp([
      {
        method: "GET",
        path: /\/1\.6\/notifications/,
        status: 200,
        body: notificationsPage(false, 2),
      },
      // include_contacts:true → the terminal fast path fans out getContacts per
      // lead (org + paid contact paths). Mock both so the contacts actually come
      // back and the swallowed-error path can't mask an empty result.
      {
        method: "GET",
        path: /\/1\.6\/leads\/lead-a\/contacts\?IncludeEnriched=true/,
        status: 200,
        body: [
          {
            id: "c1",
            first_name: "Alice",
            last_name: "",
            email: "alice@x.com",
            phone_number: null,
            linkedin_page: null,
            job_title: "CEO",
            recommended: true,
            enrichment: { done: true, credits_used: 1 },
          },
        ],
      },
      {
        method: "GET",
        path: /\/1\.6\/leads\/lead-a\/enrich\/contacts\?IncludeEnriched=true/,
        status: 200,
        body: [],
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
    // The contacts contract this test claims to cover: the enriched contact
    // actually comes back, not a bare {lead_id}.
    expect(res.leads[0].contacts).toBeDefined();
    expect(res.leads[0].contacts[0].email).toBe("alice@x.com");
  });

  it("plateau report: include_contacts returns contacts even while in_progress", async () => {
    // The P1 the stay-active guidance depends on. A job can plateau below 100%
    // with in_progress:true forever (unresolvable contacts). The guidance tells
    // the agent to report the RESOLVED contacts at that plateau — so a
    // include_contacts:true read while in_progress MUST fan out and return the
    // contacts that landed, not bare {lead_id}. (Regression guard: the fast
    // path used to gate the fan-out on `!inProgress && includeContacts`.)
    const { tracker, bulkId } = await seedLaunchedRecord();
    mockHttp([
      // Notification still in_progress (plateau) with bulk_progress present.
      {
        method: "GET",
        path: /\/1\.6\/notifications/,
        status: 200,
        body: notificationsPage(true, 1),
      },
      // The fan-out: getContacts hits org + paid contacts per lead.
      {
        method: "GET",
        path: /\/1\.6\/leads\/lead-a\/contacts\?IncludeEnriched=true/,
        status: 200,
        body: [
          {
            id: "c1",
            first_name: "Alice",
            last_name: "",
            email: "alice@x.com",
            phone_number: null,
            linkedin_page: null,
            job_title: "CEO",
            recommended: true,
            enrichment: { done: true, credits_used: 1 },
          },
        ],
      },
      {
        method: "GET",
        path: /\/1\.6\/leads\/lead-a\/enrich\/contacts\?IncludeEnriched=true/,
        status: 200,
        body: [],
      },
      // Report read (include_contacts) force-reads the credit balance.
      {
        method: "GET",
        path: /\/1\.6\/users\/me/,
        status: 200,
        body: { id: "u", organization: { id: "org", billing: { ai_credits: 7 } } },
      },
    ]);

    const res: any = await bulkEnrichStatus.execute(
      newClient(),
      { bulk_id: bulkId, include_contacts: true },
      { bulkTracker: tracker }
    );

    // Still in progress (plateau) — but the resolved contact came back.
    expect(res.in_progress).toBe(true);
    expect(res.all_done).toBe(false);
    expect(res.leads[0].contacts).toBeDefined();
    expect(res.leads[0].contacts[0].email).toBe("alice@x.com");
    // Balance surfaced on the report read, even mid-flight.
    expect(res.credits_remaining).toBe(7);
  });

  it("interim poll: include_contacts=false while in_progress stays cheap (no contacts, no credit read)", async () => {
    // The other half of the contract: a cheap interim poll must NOT fan out and
    // must NOT read /users/me — only one GET /notifications is consumed.
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
    expect(res.leads[0].contacts).toBeUndefined();
    expect(res.credits_remaining).toBeUndefined();
    // Only the notifications script was consumed — no contacts/me fan-out.
    expect(getHttpRequests()).toHaveLength(1);
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
