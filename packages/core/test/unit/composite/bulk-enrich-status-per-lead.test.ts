/**
 * Per-lead progress, computed from what the agent carries (leadbay/mcp#197).
 *
 * These behaviours existed on main and were computed from the bulk store. They
 * never needed the store — they needed `lead_ids`, `titles`, `email` and
 * `phone`, all of which `leadbay_enrich_titles` returns and the agent holds. So
 * deleting the store does not cost them, and this file is what says so.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { bulkEnrichStatus } from "../../../src/composite/bulk-enrich-status.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");
const LEAD = "lead-a";

const contact = (over: Record<string, unknown>) => ({
  id: "c1",
  job_title: "CEO",
  email: null,
  phone_number: null,
  enrichment: { done: true },
  ...over,
});

const contactsFor = (body: unknown[]) => [
  { method: "GET" as const, path: `/1.6/leads/${LEAD}/contacts?IncludeEnriched=true`, status: 200, body },
  { method: "GET" as const, path: `/1.6/leads/${LEAD}/enrich/contacts?IncludeEnriched=true`, status: 200, body: [] },
];
const me = { method: "GET" as const, path: "/1.6/users/me", status: 200, body: { id: "u", organization: { id: "o" } } };

beforeEach(() => resetHttpMock());

describe("bulk_enrich_status per-lead progress", () => {
  it("reports done/total per lead, not just one aggregate", async () => {
    mockHttp([
      ...contactsFor([
        contact({ id: "c1", email: "a@x.com" }),
        contact({ id: "c2", email: null, enrichment: { done: false } }),
      ]),
    ]);
    const res: any = await bulkEnrichStatus.execute(newClient(), {
      lead_ids: [LEAD],
      titles: ["CEO"],
      email: true,
    });

    expect(res.leads[0].enrichment_progress).toEqual({ done: 1, total: 2 });
    expect(res.all_done).toBe(false);
  });

  it("a phone-only run does NOT count an email-enriched contact as done", async () => {
    // The regression this guards: enrichment.done is true and an email exists
    // from an earlier run, but the phone reveal has not landed. Counting it
    // would flip all_done before the thing the user paid for arrives.
    mockHttp([
      ...contactsFor([contact({ email: "a@x.com", phone_number: null })]),
    ]);
    const res: any = await bulkEnrichStatus.execute(newClient(), {
      lead_ids: [LEAD],
      titles: ["CEO"],
      phone: true,
    });

    expect(res.leads[0].enrichment_progress).toEqual({ done: 0, total: 1 });
    expect(res.all_done).toBe(false);
  });

  it("counts it once the requested channel lands", async () => {
    mockHttp([...contactsFor([contact({ phone_number: "+1" })]), me]);
    const res: any = await bulkEnrichStatus.execute(newClient(), {
      lead_ids: [LEAD],
      titles: ["CEO"],
      phone: true,
    });
    expect(res.all_done).toBe(true);
  });

  it("scopes counting to the titles this run enriched", async () => {
    // A CFO enriched by an earlier run must not inflate a CEO run.
    mockHttp([
      ...contactsFor([
        contact({ id: "prior-cfo", job_title: "CFO", email: "cfo@x.com" }),
        contact({ id: "this-ceo", job_title: "CEO", email: "ceo@x.com" }),
      ]),
      me,
    ]);
    const res: any = await bulkEnrichStatus.execute(newClient(), {
      lead_ids: [LEAD],
      titles: ["CEO"],
      email: true,
    });
    expect(res.leads[0].enrichment_progress).toEqual({ done: 1, total: 1 });
  });

  it("a transient fetch error is a partial_failure, not a resolved lead", async () => {
    // Distinguishes "429, keep polling" from "nothing found". A flat count with
    // partial_failures present is not a plateau.
    mockHttp([
      { method: "GET", path: `/1.6/leads/${LEAD}/contacts?IncludeEnriched=true`, status: 429, body: { code: "QUOTA_EXCEEDED" } },
      { method: "GET", path: `/1.6/leads/${LEAD}/enrich/contacts?IncludeEnriched=true`, status: 429, body: { code: "QUOTA_EXCEEDED" } },
    ]);
    const res: any = await bulkEnrichStatus.execute(newClient(), { lead_ids: [LEAD], titles: ["CEO"] });

    expect(res.partial_failures).toHaveLength(1);
    expect(res.partial_failures[0].lead_id).toBe(LEAD);
    expect(res.all_done).toBe(false);
    expect(res.leads).toEqual([]);
  });

  it("answers from lead_ids alone — no notification needed", async () => {
    // The dead end this removes: an archived notification, or one behind 50
    // newer ones, is unfindable. lead_ids still answers.
    mockHttp([...contactsFor([contact({ email: "a@x.com" })]), me]);
    const res: any = await bulkEnrichStatus.execute(newClient(), {
      lead_ids: [LEAD],
      titles: ["CEO"],
      email: true,
    });
    expect(res.error).toBeUndefined();
    expect(res.all_done).toBe(true);
  });
});
