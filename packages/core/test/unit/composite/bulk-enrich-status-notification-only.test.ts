/**
 * leadbay_bulk_enrich_status answers when the caller has only the job id
 * (leadbay/product#4143).
 *
 * A contact enrichment's notification carries no per-contact counters — the
 * backend's docs/adr/notifications.md leaves enrichment out of the bulk-counter
 * scheme, and 0 of the 460 enrichment notifications fr_prod minted in 90 days
 * has `total_count`. So every id-only poll used to raise
 * `ENRICH_JOB_NO_COUNTERS`, on the exact path leadbay_enrich_titles tells the
 * agent to keep for later conversations.
 *
 * The notification names the bulk it belongs to, so the tool reads that bulk's
 * leads back from the backend and answers through the per-lead path.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory, getHttpRequests } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { bulkEnrichStatus } from "../../../src/composite/bulk-enrich-status.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

// The two jobs of the product#4143 reproduction run, FR org, 2026-09-16.
const NOTIF = "8f9a6aa9-e798-4248-9093-51848060e457";
const BULK_ID = "827";
const LEAD_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LEAD_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/**
 * The row the backend actually returns: `bulk_progress` ABSENT (it serializes with
 * explicitNulls off, so the field never reaches the wire), `bulk_enrichment` link set.
 * Verified live against fr_staging notification cbe348d4 on 2026-09-16.
 */
const notification = (over: Record<string, unknown> = {}) => ({
  id: NOTIF,
  created_at: "2026-09-16T04:13:01Z",
  updated_at: "2026-09-16T04:13:45Z",
  first_seen_at: null,
  archived: false,
  language: "en",
  title: "3 out of 3 contacts have been successfully enriched.",
  content: null,
  in_progress: false,
  links: [{ type: "bulk_enrichment", id: BULK_ID }],
  file_import_id: null,
  ...over,
});

const listing = (n: unknown) => ({
  method: "GET" as const,
  path: /^\/1\.6\/notifications/,
  status: 200,
  body: { items: [n], total_unseen: 0, pagination: { page: 0, pages: 1, count: 1 } },
});

const bulkLeads = (ids: string[], pages = 1) => ({
  method: "GET" as const,
  path: new RegExp(`^/1\\.6/leads/bulk_enrichments/${BULK_ID}/leads\\?`),
  status: 200,
  body: {
    items: ids.map((id) => ({ id })),
    pagination: { page: 0, pages, total: ids.length },
  },
});

const paidContacts = (leadId: string, contacts: unknown[]) => ({
  method: "GET" as const,
  path: new RegExp(`^/1\\.6/leads/${leadId}/enrich/contacts`),
  status: 200,
  body: contacts,
});

const orgContacts = (leadId: string, contacts: unknown[] = []) => ({
  method: "GET" as const,
  path: new RegExp(`^/1\\.6/leads/${leadId}/contacts`),
  status: 200,
  body: contacts,
});

const me = {
  method: "GET" as const,
  path: "/1.6/users/me",
  status: 200,
  body: { id: "u", organization: { id: "o" }, billing: { ai_credits: 3 } },
};

const contact = (id: string, done: boolean) => ({
  id,
  first_name: "Ada",
  last_name: "Lovelace",
  email: done ? "ada@example.com" : null,
  phone_number: null,
  linkedin_page: null,
  job_title: "Managing Director",
  recommended: true,
  enrichment: { done, email_requested: true, phone_requested: false, credits_used: done ? 1 : 0 },
});

beforeEach(() => resetHttpMock());

describe("leadbay_bulk_enrich_status — notification_id with no lead_ids", () => {
  it("answers a finished job instead of raising ENRICH_JOB_NO_COUNTERS", async () => {
    mockHttp([
      listing(notification()),
      bulkLeads([LEAD_A, LEAD_B]),
      orgContacts(LEAD_A),
      paidContacts(LEAD_A, [contact("c1", true)]),
      orgContacts(LEAD_B),
      paidContacts(LEAD_B, [contact("c2", true)]),
      me,
    ]);

    const res: any = await bulkEnrichStatus.execute(newClient(), { notification_id: NOTIF });

    expect(res.error).toBeUndefined();
    expect(res.code).toBeUndefined();
    expect(res.status).toBe("complete");
    expect(res.all_done).toBe(true);
    expect(res.in_progress).toBe(false);
    expect(res.overall_progress).toEqual({ done: 2, total: 2, done_ratio: 1 });
    expect(res.leads.map((l: any) => l.lead_id)).toEqual([LEAD_A, LEAD_B]);
  });

  it("reports a mid-flight job as launched, with the settled contacts counted", async () => {
    mockHttp([
      listing(notification({ in_progress: true, title: "Enrichment in progress" })),
      bulkLeads([LEAD_A, LEAD_B]),
      orgContacts(LEAD_A),
      paidContacts(LEAD_A, [contact("c1", true)]),
      orgContacts(LEAD_B),
      paidContacts(LEAD_B, [contact("c2", false)]),
    ]);

    const res: any = await bulkEnrichStatus.execute(newClient(), { notification_id: NOTIF });

    expect(res.error).toBeUndefined();
    expect(res.status).toBe("launched");
    expect(res.all_done).toBe(false);
    expect(res.in_progress).toBe(true);
    expect(res.overall_progress).toEqual({ done: 1, total: 2, done_ratio: 0.5 });
  });

  it("reads the job's lead set from the bulk the notification names", async () => {
    mockHttp([
      listing(notification()),
      bulkLeads([LEAD_A]),
      orgContacts(LEAD_A),
      paidContacts(LEAD_A, [contact("c1", true)]),
      me,
    ]);

    await bulkEnrichStatus.execute(newClient(), { notification_id: NOTIF });

    const bulkRead = getHttpRequests().find((r) =>
      r.path.startsWith(`/1.6/leads/bulk_enrichments/${BULK_ID}/leads`)
    );
    expect(bulkRead).toBeDefined();
    // Status polls stay cheap: no contact payloads on the lead listing itself.
    expect(bulkRead!.path).toContain("contacts=false");
  });

  it("falls back to the backend's job state when the lead set cannot be read", async () => {
    mockHttp([
      listing(notification()),
      {
        method: "GET",
        path: new RegExp(`^/1\\.6/leads/bulk_enrichments/${BULK_ID}/leads\\?`),
        status: 500,
        body: { message: "boom" },
      },
      me,
    ]);

    const res: any = await bulkEnrichStatus.execute(newClient(), { notification_id: NOTIF });

    expect(res.error).toBeUndefined();
    expect(res.status).toBe("complete");
    expect(res.all_done).toBe(true);
    expect(res.in_progress).toBe(false);
    expect(res.overall_progress).toEqual({ done: 0, total: 0, done_ratio: 0 });
    expect(res.counts_hint).toContain("lead_ids");
  });

  it("treats an explicit bulk_progress: null the same as an absent one", async () => {
    mockHttp([
      listing(notification({ bulk_progress: null })),
      bulkLeads([LEAD_A]),
      orgContacts(LEAD_A),
      paidContacts(LEAD_A, [contact("c1", true)]),
      me,
    ]);

    const res: any = await bulkEnrichStatus.execute(newClient(), { notification_id: NOTIF });

    expect(res.error).toBeUndefined();
    expect(res.overall_progress).toEqual({ done: 1, total: 1, done_ratio: 1 });
  });

  it("does not read the bulk when the caller already passed lead_ids", async () => {
    mockHttp([
      listing(notification()),
      orgContacts(LEAD_A),
      paidContacts(LEAD_A, [contact("c1", true)]),
      me,
    ]);

    const res: any = await bulkEnrichStatus.execute(newClient(), {
      notification_id: NOTIF,
      lead_ids: [LEAD_A],
    });

    expect(res.all_done).toBe(true);
    expect(
      getHttpRequests().some((r) => r.path.includes("/bulk_enrichments/"))
    ).toBe(false);
  });
});
