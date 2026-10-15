/**
 * leadbay_campaign_progression — the summary is the whole campaign (mcp#276).
 *
 * Before this file, `summary` was counted from the one page in `items` and
 * the description presented it as the campaign headline, so a 300-lead
 * campaign was described by its first 50 rows. The summary keeps its four
 * keys and its per-lead rule; the tool now reads the campaign's other pages
 * too and counts each lead once. `summary_coverage` says what the counts
 * cover, and `complete` is strict: every page read echoes the page that was
 * requested as a whole number and agrees on `pages` and `total`, every page
 * was read, every lead has an id, and the leads counted equal the total.
 * Page information the backend sends as text, null or a decimal is echoed
 * as null, so the envelope always matches the schema.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLogger,
  expectAllScriptsConsumed,
  getHttpRequests,
  httpsMockFactory,
  mockHttp,
  resetHttpMock,
} from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { campaignProgression } from "../../../src/composite/campaign-progression.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

const PATH = (page: number, count = 50) =>
  `/1.6/campaigns/camp-1/leads?count=${count}&page=${page}`;

const requestedPages = () =>
  getHttpRequests().map((r) => Number(new URL(r.url).searchParams.get("page")));

const NO_PAGINATION = { page: null, pages: null, total: null };

function row(
  id: string | undefined,
  progress: Partial<{ in_progress: number; declined: number; headline: string | null }> = {},
) {
  return {
    lead: id === undefined ? { name: "No id" } : { id, name: `Lead ${id}` },
    progress: {
      total_contacts: 3,
      in_progress: progress.in_progress ?? 0,
      declined: progress.declined ?? 0,
      headline: progress.headline ?? null,
    },
    affiliation: { own_campaigns: [], other_users_campaign_count: 0 },
  };
}

// Three rows that roll up to 2 contacted / 1 in progress / 1 declined: a
// decline is an outreach signal, so the declined lead counts as contacted too.
function trio(prefix: string) {
  return [
    row(`${prefix}-a`, { headline: "CONTACTED", in_progress: 1 }),
    row(`${prefix}-b`, { declined: 1 }),
    row(`${prefix}-c`),
  ];
}

// `pagination` undefined → built from page/pages/total; `false` → omitted;
// anything else → sent as-is (for malformed values).
function pageScript(
  page: number,
  opts: {
    pages?: number;
    total?: number;
    items?: unknown[];
    count?: number;
    pagination?: false | Record<string, unknown> | string;
  } = {},
) {
  const items = opts.items ?? trio(`p${page}`);
  const body: Record<string, unknown> = { items };
  if (opts.pagination === undefined) {
    body.pagination = { page, pages: opts.pages ?? 1, total: opts.total ?? items.length };
  } else if (opts.pagination !== false) {
    body.pagination = opts.pagination;
  }
  return { method: "GET", path: PATH(page, opts.count ?? 50), status: 200, body };
}

describe("campaign_progression — summary covers the whole campaign", () => {
  it("a one-page campaign costs no extra read and is complete", async () => {
    mockHttp([pageScript(0)]);
    const result: any = await campaignProgression.execute(newClient(), { campaign_id: "camp-1" });
    expect(result.summary).toEqual({ page_size: 3, contacted: 2, in_progress: 1, declined: 1 });
    expect(result.summary_coverage).toEqual({ leads: 3, total_leads: 3, complete: true });
    expect(result.pagination).toEqual({ page: 0, pages: 1, total: 3 });
    expect(requestedPages()).toEqual([0]);
    expectAllScriptsConsumed();
  });

  it("a three-page campaign is counted across every page; items stays the requested page", async () => {
    mockHttp([
      pageScript(0, { pages: 3, total: 9 }),
      pageScript(1, { pages: 3, total: 9 }),
      pageScript(2, { pages: 3, total: 9 }),
    ]);
    const result: any = await campaignProgression.execute(newClient(), { campaign_id: "camp-1" });
    // 3 pages × (2 contacted / 1 in progress / 1 declined)
    expect(result.summary).toEqual({ page_size: 3, contacted: 6, in_progress: 3, declined: 3 });
    expect(result.summary_coverage).toEqual({ leads: 9, total_leads: 9, complete: true });
    expect(result.items.map((r: any) => r.lead.id)).toEqual(["p0-a", "p0-b", "p0-c"]);
    expect(result.pagination).toEqual({ page: 0, pages: 3, total: 9 });
    expect(requestedPages()).toEqual([0, 1, 2]);
    expectAllScriptsConsumed();
  });

  it("the requested page is not fetched twice", async () => {
    mockHttp([
      pageScript(1, { pages: 3, total: 9 }),
      pageScript(0, { pages: 3, total: 9 }),
      pageScript(2, { pages: 3, total: 9 }),
    ]);
    const result: any = await campaignProgression.execute(newClient(), { campaign_id: "camp-1", page: 1 });
    expect(result.items.map((r: any) => r.lead.id)).toEqual(["p1-a", "p1-b", "p1-c"]);
    expect(result.summary_coverage.complete).toBe(true);
    expect(requestedPages()).toEqual([1, 0, 2]);
    expectAllScriptsConsumed();
  });

  it("the extra pages use the same count, so page boundaries line up", async () => {
    mockHttp([
      pageScript(0, { pages: 2, total: 6, count: 10 }),
      pageScript(1, { pages: 2, total: 6, count: 10 }),
    ]);
    const result: any = await campaignProgression.execute(newClient(), { campaign_id: "camp-1", count: 10 });
    expect(result.summary_coverage).toEqual({ leads: 6, total_leads: 6, complete: true });
    expect(getHttpRequests().map((r) => r.path)).toEqual([PATH(0, 10), PATH(1, 10)]);
    expectAllScriptsConsumed();
  });

  it("a lead that lands on two pages is counted once", async () => {
    const shared = row("shared", { declined: 1 });
    mockHttp([
      pageScript(0, { pages: 2, total: 3, items: [row("a", { headline: "CONTACTED", in_progress: 1 }), shared] }),
      pageScript(1, { pages: 2, total: 3, items: [shared, row("c")] }),
    ]);
    const result: any = await campaignProgression.execute(newClient(), { campaign_id: "camp-1" });
    // Double-counting "shared" would give contacted 3 / declined 2.
    expect(result.summary).toEqual({ page_size: 2, contacted: 2, in_progress: 1, declined: 1 });
    expect(result.summary_coverage).toEqual({ leads: 3, total_leads: 3, complete: true });
    expectAllScriptsConsumed();
  });

  it("the read stops at 20 pages and says the counts are incomplete", async () => {
    const PAGES = 25;
    mockHttp(Array.from({ length: 20 }, (_, p) => pageScript(p, { pages: PAGES, total: PAGES * 3 })));
    const result: any = await campaignProgression.execute(newClient(), { campaign_id: "camp-1" });
    expect(result.summary_coverage).toEqual({ leads: 60, total_leads: 75, complete: false });
    expect(result.summary).toEqual({ page_size: 3, contacted: 40, in_progress: 20, declined: 20 });
    // Exactly 20 reads, pages 0..19; nothing past the cap was requested.
    expect(requestedPages()).toEqual(Array.from({ length: 20 }, (_, p) => p));
    expectAllScriptsConsumed();
  });

  it("a capped read still includes a requested page beyond the window, so the counts are not a prefix", async () => {
    const PAGES = 25;
    mockHttp([
      pageScript(24, { pages: PAGES, total: PAGES * 3 }),
      ...Array.from({ length: 19 }, (_, p) => pageScript(p, { pages: PAGES, total: PAGES * 3 })),
    ]);
    const result: any = await campaignProgression.execute(newClient(), { campaign_id: "camp-1", page: 24 });
    expect(result.items.map((r: any) => r.lead.id)).toEqual(["p24-a", "p24-b", "p24-c"]);
    expect(result.summary_coverage).toEqual({ leads: 60, total_leads: 75, complete: false });
    expect(requestedPages()).toEqual([24, ...Array.from({ length: 19 }, (_, p) => p)]);
    expectAllScriptsConsumed();
  });

  it("a failed extra page ends the read: partial counts, incomplete, logged, nothing further requested", async () => {
    mockHttp([
      pageScript(0, { pages: 4, total: 12 }),
      pageScript(1, { pages: 4, total: 12 }),
      { method: "GET", path: PATH(2), status: 500, body: { error: "boom" } },
      // page 3 is deliberately not declared: it must not be requested.
    ]);
    const { logger, logs } = createLogger();
    const result: any = await campaignProgression.execute(newClient(), { campaign_id: "camp-1" }, { logger });
    expect(result.summary).toEqual({ page_size: 3, contacted: 4, in_progress: 2, declined: 2 });
    expect(result.summary_coverage).toEqual({ leads: 6, total_leads: 12, complete: false });
    expect(requestedPages()).toEqual([0, 1, 2]);
    expect(logs.some((l) => l.level === "warn" && l.msg.includes("page 2 of 4") && l.msg.includes("failed"))).toBe(true);
    expectAllScriptsConsumed();
  });

  it("a 429 on an extra page never reaches the agent as a quota error", async () => {
    mockHttp([
      pageScript(0, { pages: 2, total: 6 }),
      {
        method: "GET",
        path: PATH(1),
        status: 429,
        body: { error: "quota_exceeded" },
        responseHeaders: { "retry-after": "30" },
      },
    ]);
    const { logger, logs } = createLogger();
    const result: any = await campaignProgression.execute(newClient(), { campaign_id: "camp-1" }, { logger });
    expect(result.summary_coverage).toEqual({ leads: 3, total_leads: 6, complete: false });
    expect(logs.some((l) => l.level === "warn" && l.msg.includes("QUOTA_EXCEEDED"))).toBe(true);
    expectAllScriptsConsumed();
  });

  it("a failed requested page still fails the call — that page is the answer", async () => {
    mockHttp([{ method: "GET", path: PATH(0), status: 404, body: { error: "not found" } }]);
    await expect(
      campaignProgression.execute(newClient(), { campaign_id: "camp-1" }),
    ).rejects.toThrow();
  });

  it("a cancellation during an extra page is not swallowed", async () => {
    const cancelled = Object.assign(new Error("cancelled"), { name: "AbortError", code: "CANCELLED" });
    mockHttp([
      pageScript(0, { pages: 2, total: 6 }),
      { method: "GET", path: PATH(1), status: 200, error: cancelled },
    ]);
    await expect(
      campaignProgression.execute(newClient(), { campaign_id: "camp-1" }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("an empty campaign reports zeros and is complete", async () => {
    mockHttp([pageScript(0, { pages: 0, total: 0, items: [] })]);
    const result: any = await campaignProgression.execute(newClient(), { campaign_id: "camp-1" });
    expect(result.items).toEqual([]);
    expect(result.summary).toEqual({ page_size: 0, contacted: 0, in_progress: 0, declined: 0 });
    expect(result.summary_coverage).toEqual({ leads: 0, total_leads: 0, complete: true });
    expect(requestedPages()).toEqual([0]);
    expectAllScriptsConsumed();
  });

  it("a distinct lead count that does not match the total is marked incomplete", async () => {
    // The backend says 5 leads; one page of 3 rows is all there is.
    mockHttp([pageScript(0, { pages: 1, total: 5 })]);
    const result: any = await campaignProgression.execute(newClient(), { campaign_id: "camp-1" });
    expect(result.summary_coverage).toEqual({ leads: 3, total_leads: 5, complete: false });
    expectAllScriptsConsumed();
  });

  it("a requested page past the end returns no rows but still the campaign's summary", async () => {
    mockHttp([
      pageScript(5, { pages: 2, total: 6, items: [] }),
      pageScript(0, { pages: 2, total: 6 }),
      pageScript(1, { pages: 2, total: 6 }),
    ]);
    const result: any = await campaignProgression.execute(newClient(), { campaign_id: "camp-1", page: 5 });
    expect(result.items).toEqual([]);
    expect(result.summary).toEqual({ page_size: 0, contacted: 4, in_progress: 2, declined: 2 });
    expect(result.summary_coverage).toEqual({ leads: 6, total_leads: 6, complete: true });
    expect(requestedPages()).toEqual([5, 0, 1]);
    expectAllScriptsConsumed();
  });

  it("a page and count sent as text by the host are read as numbers, so a healthy campaign stays complete", async () => {
    mockHttp([
      pageScript(1, { pages: 2, total: 6, count: 10 }),
      pageScript(0, { pages: 2, total: 6, count: 10 }),
    ]);
    const result: any = await campaignProgression.execute(newClient(), {
      campaign_id: "camp-1",
      page: "1" as unknown as number,
      count: "10" as unknown as number,
    });
    expect(result.items.map((r: any) => r.lead.id)).toEqual(["p1-a", "p1-b", "p1-c"]);
    expect(result.summary_coverage).toEqual({ leads: 6, total_leads: 6, complete: true });
    expect(getHttpRequests().map((r) => r.path)).toEqual([PATH(1, 10), PATH(0, 10)]);
    expectAllScriptsConsumed();
  });

  it("the key sets are fixed, so the schema can pin them", async () => {
    mockHttp([pageScript(0, { pages: 2, total: 6 }), pageScript(1, { pages: 2, total: 6 })]);
    const result: any = await campaignProgression.execute(newClient(), { campaign_id: "camp-1" });
    expect(Object.keys(result.summary).sort()).toEqual(["contacted", "declined", "in_progress", "page_size"]);
    expect(Object.keys(result.summary_coverage).sort()).toEqual(["complete", "leads", "total_leads"]);
    expect(Object.keys(result.pagination).sort()).toEqual(["page", "pages", "total"]);
  });
});

describe("campaign_progression — when the page information cannot be trusted", () => {
  it("a later page that reports a different total marks the counts incomplete", async () => {
    mockHttp([
      pageScript(0, { pages: 2, total: 6 }),
      pageScript(1, { pagination: { page: 1, pages: 2, total: 7 } }),
    ]);
    const result: any = await campaignProgression.execute(newClient(), { campaign_id: "camp-1" });
    // Both pages were read and 6 leads counted, but the campaign moved under us.
    expect(result.summary_coverage).toEqual({ leads: 6, total_leads: 6, complete: false });
    expectAllScriptsConsumed();
  });

  it("a later page that reports a different page count marks the counts incomplete", async () => {
    mockHttp([
      pageScript(0, { pages: 2, total: 6 }),
      pageScript(1, { pagination: { page: 1, pages: 3, total: 6 } }),
    ]);
    const result: any = await campaignProgression.execute(newClient(), { campaign_id: "camp-1" });
    expect(result.summary_coverage).toEqual({ leads: 6, total_leads: 6, complete: false });
    expectAllScriptsConsumed();
  });

  it("a later page without pagination marks the counts incomplete", async () => {
    mockHttp([
      pageScript(0, { pages: 2, total: 6 }),
      pageScript(1, { pagination: false }),
    ]);
    const result: any = await campaignProgression.execute(newClient(), { campaign_id: "camp-1" });
    expect(result.summary).toEqual({ page_size: 3, contacted: 4, in_progress: 2, declined: 2 });
    expect(result.summary_coverage).toEqual({ leads: 6, total_leads: 6, complete: false });
    expectAllScriptsConsumed();
  });

  it("a later page that echoes a different page number than requested marks the counts incomplete", async () => {
    mockHttp([
      pageScript(0, { pages: 2, total: 6 }),
      pageScript(1, { pagination: { page: 0, pages: 2, total: 6 } }),
    ]);
    const result: any = await campaignProgression.execute(newClient(), { campaign_id: "camp-1" });
    expect(result.summary_coverage).toEqual({ leads: 6, total_leads: 6, complete: false });
    expectAllScriptsConsumed();
  });

  it("a later page whose page number is a decimal marks the counts incomplete", async () => {
    mockHttp([
      pageScript(0, { pages: 2, total: 6 }),
      pageScript(1, { pagination: { page: 1.5, pages: 2, total: 6 } }),
    ]);
    const result: any = await campaignProgression.execute(newClient(), { campaign_id: "camp-1" });
    expect(result.summary_coverage).toEqual({ leads: 6, total_leads: 6, complete: false });
    expectAllScriptsConsumed();
  });

  it("a later page whose page number is text marks the counts incomplete", async () => {
    mockHttp([
      pageScript(0, { pages: 2, total: 6 }),
      pageScript(1, { pagination: { page: "1", pages: 2, total: 6 } }),
    ]);
    const result: any = await campaignProgression.execute(newClient(), { campaign_id: "camp-1" });
    expect(result.summary_coverage).toEqual({ leads: 6, total_leads: 6, complete: false });
    expectAllScriptsConsumed();
  });

  it("a later page whose total is null marks the counts incomplete", async () => {
    mockHttp([
      pageScript(0, { pages: 2, total: 6 }),
      pageScript(1, { pagination: { page: 1, pages: 2, total: null } }),
    ]);
    const result: any = await campaignProgression.execute(newClient(), { campaign_id: "camp-1" });
    expect(result.summary_coverage).toEqual({ leads: 6, total_leads: 6, complete: false });
    expectAllScriptsConsumed();
  });

  it("a first page that echoes a different page number than requested is counted but not complete", async () => {
    mockHttp([
      // The backend answers the page-0 request with page 1's rows and says so.
      pageScript(0, { items: trio("p1"), pagination: { page: 1, pages: 2, total: 6 } }),
      // The page in hand is page 1, so page 0 is the one still to read.
      pageScript(0, { pages: 2, total: 6 }),
    ]);
    const result: any = await campaignProgression.execute(newClient(), { campaign_id: "camp-1" });
    expect(result.pagination).toEqual({ page: 1, pages: 2, total: 6 });
    expect(result.summary_coverage).toEqual({ leads: 6, total_leads: 6, complete: false });
    expect(requestedPages()).toEqual([0, 0]);
    expectAllScriptsConsumed();
  });

  it("a response without pagination is counted, echoed as nulls, and marked incomplete with no total", async () => {
    mockHttp([pageScript(0, { pagination: false })]);
    const result: any = await campaignProgression.execute(newClient(), { campaign_id: "camp-1" });
    expect(result.pagination).toEqual(NO_PAGINATION);
    expect(result.summary).toEqual({ page_size: 3, contacted: 2, in_progress: 1, declined: 1 });
    expect(result.summary_coverage).toEqual({ leads: 3, total_leads: null, complete: false });
    expect(requestedPages()).toEqual([0]);
    expectAllScriptsConsumed();
  });

  it("a pagination that is not an object is treated as missing", async () => {
    mockHttp([pageScript(0, { pagination: "2 of 3" })]);
    const result: any = await campaignProgression.execute(newClient(), { campaign_id: "camp-1" });
    expect(result.pagination).toEqual(NO_PAGINATION);
    expect(result.summary_coverage).toEqual({ leads: 3, total_leads: null, complete: false });
    expect(requestedPages()).toEqual([0]);
    expectAllScriptsConsumed();
  });

  it("text where the numbers should be: echoed as nulls, nothing trusted, envelope intact", async () => {
    mockHttp([pageScript(0, { pagination: { page: "0", pages: "1", total: "3" } })]);
    const result: any = await campaignProgression.execute(newClient(), { campaign_id: "camp-1" });
    expect(result.pagination).toEqual(NO_PAGINATION);
    expect(result.summary).toEqual({ page_size: 3, contacted: 2, in_progress: 1, declined: 1 });
    expect(result.summary_coverage).toEqual({ leads: 3, total_leads: null, complete: false });
    expect(requestedPages()).toEqual([0]);
    expectAllScriptsConsumed();
  });

  it("null where the numbers should be: echoed as nulls, nothing trusted, envelope intact", async () => {
    mockHttp([pageScript(0, { pagination: { page: null, pages: null, total: null } })]);
    const result: any = await campaignProgression.execute(newClient(), { campaign_id: "camp-1" });
    expect(result.pagination).toEqual(NO_PAGINATION);
    expect(result.summary_coverage).toEqual({ leads: 3, total_leads: null, complete: false });
    expect(requestedPages()).toEqual([0]);
    expectAllScriptsConsumed();
  });

  it("a text total alone leaves the campaign size unknown", async () => {
    mockHttp([pageScript(0, { pagination: { page: 0, pages: 1, total: "3" } })]);
    const result: any = await campaignProgression.execute(newClient(), { campaign_id: "camp-1" });
    expect(result.pagination).toEqual({ page: 0, pages: 1, total: null });
    expect(result.summary_coverage).toEqual({ leads: 3, total_leads: null, complete: false });
    expectAllScriptsConsumed();
  });

  it("a page count that is not a whole number is not trusted: no extra reads, incomplete", async () => {
    mockHttp([pageScript(0, { pagination: { page: 0, pages: 2.5, total: 6 } })]);
    const result: any = await campaignProgression.execute(newClient(), { campaign_id: "camp-1" });
    expect(result.pagination).toEqual({ page: 0, pages: null, total: 6 });
    expect(result.summary_coverage).toEqual({ leads: 3, total_leads: 6, complete: false });
    expect(requestedPages()).toEqual([0]);
    expectAllScriptsConsumed();
  });

  it("a total that is not a whole number leaves the campaign size unknown", async () => {
    mockHttp([pageScript(0, { pagination: { page: 0, pages: 1, total: 3.5 } })]);
    const result: any = await campaignProgression.execute(newClient(), { campaign_id: "camp-1" });
    expect(result.pagination).toEqual({ page: 0, pages: 1, total: null });
    expect(result.summary_coverage).toEqual({ leads: 3, total_leads: null, complete: false });
    expectAllScriptsConsumed();
  });

  it("an echoed page number that is not a whole number marks the counts incomplete", async () => {
    mockHttp([
      pageScript(0, { pagination: { page: 0.5, pages: 2, total: 6 } }),
      pageScript(1, { pages: 2, total: 6 }),
    ]);
    const result: any = await campaignProgression.execute(newClient(), { campaign_id: "camp-1" });
    // The other page is still read (the requested page number says which to skip).
    expect(result.pagination).toEqual({ page: null, pages: 2, total: 6 });
    expect(result.summary_coverage).toEqual({ leads: 6, total_leads: 6, complete: false });
    expect(requestedPages()).toEqual([0, 1]);
    expectAllScriptsConsumed();
  });

  it("a page count that is missing while the total is present: no extra reads, total known, incomplete", async () => {
    mockHttp([pageScript(0, { pagination: { page: 0, total: 3 } })]);
    const result: any = await campaignProgression.execute(newClient(), { campaign_id: "camp-1" });
    expect(result.pagination).toEqual({ page: 0, pages: null, total: 3 });
    expect(result.summary_coverage).toEqual({ leads: 3, total_leads: 3, complete: false });
    expect(requestedPages()).toEqual([0]);
    expectAllScriptsConsumed();
  });

  it("a lead without an id is counted but the counts are not called complete", async () => {
    mockHttp([
      pageScript(0, {
        pages: 1,
        total: 3,
        items: [row("a", { headline: "CONTACTED" }), row(undefined, { declined: 1 }), row("c")],
      }),
    ]);
    const result: any = await campaignProgression.execute(newClient(), { campaign_id: "camp-1" });
    expect(result.summary).toEqual({ page_size: 3, contacted: 2, in_progress: 0, declined: 1 });
    expect(result.summary_coverage).toEqual({ leads: 3, total_leads: 3, complete: false });
    expectAllScriptsConsumed();
  });

  it("a response without items still produces a well-formed envelope", async () => {
    mockHttp([{ method: "GET", path: PATH(0), status: 200, body: {} }]);
    const result: any = await campaignProgression.execute(newClient(), { campaign_id: "camp-1" });
    expect(result.items).toEqual([]);
    expect(result.pagination).toEqual(NO_PAGINATION);
    expect(result.summary).toEqual({ page_size: 0, contacted: 0, in_progress: 0, declined: 0 });
    expect(result.summary_coverage).toEqual({ leads: 0, total_leads: null, complete: false });
    expectAllScriptsConsumed();
  });
});
