/**
 * product#4102: a bulk run's reservations sit on the source:"paid" records,
 * which never carry email / phone_number — the revealed values land on the
 * person's source:"org" twin, which carries no reservation. Fixtures below are
 * shaped like the live payload for lead fc34a3a8… of fr-prod bulk 801
 * (2026-09-10). Counting must read the reservation, not the channel fields.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { bulkEnrichStatus } from "../../../src/composite/bulk-enrich-status.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");
const LEAD = "lead-a";

// Org twin: revealed values, no `enrichment` key at all.
const twin = (over: Record<string, unknown>) => ({
  id: "org-1",
  first_name: "Marc",
  last_name: "Bonnin",
  email: "marc.bonnin@acso.fr",
  phone_number: "+33 6 19 14 41 49",
  job_title: "Directeur Général",
  recommended: false,
  pinned: false,
  pinned_by_ai: false,
  ...over,
});

// Paid record: the reservation, never email / phone_number.
const paid = (over: Record<string, unknown>) => ({
  id: "paid-1",
  first_name: "Marc",
  last_name: "Bonnin",
  job_title: "Directeur Général",
  recommended: false,
  enrichment: { done: true, credits_used: 11, email_requested: true, phone_requested: true },
  ...over,
});

const contactsFor = (org: unknown[], paidBody: unknown[]) => [
  { method: "GET" as const, path: `/1.6/leads/${LEAD}/contacts?IncludeEnriched=true`, status: 200, body: org },
  { method: "GET" as const, path: `/1.6/leads/${LEAD}/enrich/contacts?IncludeEnriched=true`, status: 200, body: paidBody },
];
const me = { method: "GET" as const, path: "/1.6/users/me", status: 200, body: { id: "u", organization: { id: "o" } } };

beforeEach(() => resetHttpMock());

describe("bulk_enrich_status counts the reservation on the paid record (product#4102)", () => {
  it("an email+phone run whose reservations all settled reads done === total, all_done", async () => {
    // bulk 801 in miniature: both landed (11), email only (1), phone only (10),
    // nothing found (0). Every one of them is settled.
    mockHttp([
      ...contactsFor(
        [twin({ id: "org-1" }), twin({ id: "org-2", phone_number: null }), twin({ id: "org-3", email: null })],
        [
          paid({ id: "p-both", enrichment: { done: true, credits_used: 11, email_requested: true, phone_requested: true } }),
          paid({ id: "p-email", enrichment: { done: true, credits_used: 1, email_requested: true, phone_requested: true } }),
          paid({ id: "p-phone", enrichment: { done: true, credits_used: 10, email_requested: true, phone_requested: true } }),
          paid({ id: "p-none", enrichment: { done: true, credits_used: 0, email_requested: true, phone_requested: true } }),
        ]
      ),
      me,
    ]);
    const res: any = await bulkEnrichStatus.execute(newClient(), {
      lead_ids: [LEAD],
      titles: ["Directeur Général"],
      email: true,
      phone: true,
    });

    expect(res.leads[0].enrichment_progress).toEqual({ done: 4, total: 4 });
    expect(res.overall_progress).toEqual({ done: 4, total: 4, done_ratio: 1 });
    expect(res.all_done).toBe(true);
    expect(res.status).toBe("complete");
  });

  it("a reservation still in flight keeps all_done false", async () => {
    mockHttp([
      ...contactsFor(
        [twin({ id: "org-1" })],
        [
          paid({ id: "p-done" }),
          paid({ id: "p-open", enrichment: { done: false, credits_used: 0, email_requested: true, phone_requested: true } }),
        ]
      ),
    ]);
    const res: any = await bulkEnrichStatus.execute(newClient(), {
      lead_ids: [LEAD],
      email: true,
      phone: true,
    });

    expect(res.leads[0].enrichment_progress).toEqual({ done: 1, total: 2 });
    expect(res.all_done).toBe(false);
    expect(res.status).toBe("launched");
  });

  it("a phone run leaves an earlier email-only reservation out of done AND total", async () => {
    // The backend keeps one reservation per contact and skips reserved ones, so
    // the phone run never touched p-old. It must neither flip all_done early
    // (counted as done) nor stall it forever (counted as not done).
    mockHttp([
      ...contactsFor(
        [twin({ id: "org-1", phone_number: null })],
        [
          paid({ id: "p-old", enrichment: { done: true, credits_used: 1, email_requested: true, phone_requested: false } }),
          paid({ id: "p-new", enrichment: { done: false, credits_used: 0, email_requested: false, phone_requested: true } }),
        ]
      ),
    ]);
    const res: any = await bulkEnrichStatus.execute(newClient(), {
      lead_ids: [LEAD],
      phone: true,
    });

    expect(res.leads[0].enrichment_progress).toEqual({ done: 0, total: 1 });
    expect(res.all_done).toBe(false);
  });

  it("a phone run over only earlier email-only reservations reads 0/0, not complete", async () => {
    mockHttp([
      ...contactsFor(
        [twin({ id: "org-1", phone_number: null })],
        [paid({ id: "p-old", enrichment: { done: true, credits_used: 1, email_requested: true, phone_requested: false } })]
      ),
    ]);
    const res: any = await bulkEnrichStatus.execute(newClient(), {
      lead_ids: [LEAD],
      phone: true,
    });

    expect(res.leads[0].enrichment_progress).toEqual({ done: 0, total: 0 });
    expect(res.all_done).toBe(false);
  });

  it("titles still scope: a settled CFO reservation does not count in a DG run", async () => {
    mockHttp([
      ...contactsFor(
        [twin({ id: "org-1" }), twin({ id: "org-cfo", job_title: "CFO" })],
        [paid({ id: "p-dg" }), paid({ id: "p-cfo", job_title: "CFO" })]
      ),
      me,
    ]);
    const res: any = await bulkEnrichStatus.execute(newClient(), {
      lead_ids: [LEAD],
      titles: ["Directeur Général"],
      email: true,
      phone: true,
    });

    expect(res.leads[0].enrichment_progress).toEqual({ done: 1, total: 1 });
    expect(res.all_done).toBe(true);
  });

  it("without channel flags every settled reservation counts, as before", async () => {
    mockHttp([
      ...contactsFor(
        [twin({ id: "org-1" })],
        [
          paid({ id: "p-old", enrichment: { done: true, credits_used: 1, email_requested: true, phone_requested: false } }),
          paid({ id: "p-new" }),
        ]
      ),
      me,
    ]);
    const res: any = await bulkEnrichStatus.execute(newClient(), { lead_ids: [LEAD] });

    expect(res.leads[0].enrichment_progress).toEqual({ done: 2, total: 2 });
    expect(res.all_done).toBe(true);
  });
});
