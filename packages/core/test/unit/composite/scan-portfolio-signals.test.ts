/**
 * Unit tests for leadbay_scan_portfolio_signals — the bulk, read-only
 * portfolio signal scan (issue #3704). Verifies: it reads CACHED signals
 * (no web_fetch POST), filters by query + since, separates "no match" from
 * "not researched", folds diacritics/case, caps the fan-out, and survives a
 * 429 mid-scan with partial results.
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
import { scanPortfolioSignals } from "../../../src/composite/scan-portfolio-signals.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.tok", "us");

// A web_fetch payload with the given emoji-section → entries shape.
function webFetch(leadId: string, content: any, inProgress = false) {
  return {
    method: "GET" as const,
    path: `/1.5/leads/${leadId}/web_fetch`,
    status: 200,
    body: { lead_id: leadId, content, fetch_at: "2025-06-01", in_progress: inProgress },
  };
}

beforeEach(() => resetHttpMock());

describe("leadbay_scan_portfolio_signals", () => {
  it("happy path — returns only leads whose signals match the query, with entries quoted", async () => {
    mockHttp([
      webFetch("lead-1", {
        "📈 business signals": [
          { description: "Acme acquired BetaCorp in a $40M deal", source: "techcrunch.com", date: "2025-03-01", hot: true },
          { description: "Hiring 20 engineers", source: "linkedin.com", date: "2025-02-01" },
        ],
      }),
      webFetch("lead-2", {
        "📈 business signals": [
          { description: "Opened a new office in Lyon", source: "lemonde.fr", date: "2025-04-01" },
        ],
      }),
    ]);

    const out: any = await scanPortfolioSignals.execute(newClient(), {
      query: "acquired, M&A",
      leadIds: ["lead-1", "lead-2"],
    });

    expect(out.matched).toHaveLength(1);
    expect(out.matched[0].lead_id).toBe("lead-1");
    expect(out.matched[0].matched_signals).toHaveLength(1);
    expect(out.matched[0].matched_signals[0].description).toContain("acquired BetaCorp");
    expect(out.matched[0].matched_signals[0].hot).toBe(true);
    expect(out.matched_count).toBe(1);
    expect(out.scanned_count).toBe(2);
    expect(out.not_researched).toHaveLength(0);

    // Read-only: NO web_fetch POST was issued.
    const posts = getHttpRequests().filter((r) => r.method === "POST");
    expect(posts).toHaveLength(0);
  });

  it("separates 'not researched' (null/in-progress content) from 'no match'", async () => {
    mockHttp([
      webFetch("lead-1", {
        "📈 business signals": [{ description: "raised a Series B", source: "x.com", date: "2025-05-01" }],
      }),
      webFetch("lead-2", null), // never researched
      webFetch("lead-3", { "📈 business signals": [{ description: "x" }] }, true), // still fetching
    ]);

    const out: any = await scanPortfolioSignals.execute(newClient(), {
      query: "funding, Series",
      leadIds: ["lead-1", "lead-2", "lead-3"],
    });

    expect(out.matched.map((m: any) => m.lead_id)).toEqual(["lead-1"]);
    // lead-2 (null) and lead-3 (in_progress) → not_researched, NOT silently dropped.
    expect(out.not_researched.map((n: any) => n.lead_id).sort()).toEqual(["lead-2", "lead-3"]);
    expect(out.scanned_count).toBe(3);
  });

  it("since filter — entries dated before `since` are excluded; undated entries kept", async () => {
    mockHttp([
      webFetch("lead-1", {
        "📈 business signals": [
          { description: "acquired OldCo", source: "s", date: "2024-08-01" }, // before since
          { description: "acquired NewCo", source: "s", date: "2025-02-01" }, // after since
          { description: "acquired UndatedCo", source: "s" }, // no date → kept
        ],
      }),
    ]);

    const out: any = await scanPortfolioSignals.execute(newClient(), {
      query: "acquired",
      leadIds: ["lead-1"],
      since: "2025-01-01",
    });

    const descs = out.matched[0].matched_signals.map((s: any) => s.description);
    expect(descs).toContain("acquired NewCo");
    expect(descs).toContain("acquired UndatedCo");
    expect(descs).not.toContain("acquired OldCo");
  });

  it("diacritic- and case-insensitive matching — accented query 'racheté' matches plain 'rachete', and 'M&A' matches 'm&a'", async () => {
    mockHttp([
      webFetch("lead-1", {
        // entry has NO accent + different case; query carries the accent + case.
        "📈 signals": [{ description: "L'entreprise a RACHETE un concurrent", source: "lesechos.fr", date: "2025-03-01" }],
      }),
      webFetch("lead-2", {
        "📈 signals": [{ description: "Completed an M&A transaction", source: "ft.com", date: "2025-03-01" }],
      }),
    ]);

    const out: any = await scanPortfolioSignals.execute(newClient(), {
      // "racheté" folds to "rachete" (matches lead-1 regardless of accent/case);
      // "m&a" matches lead-2's "M&A" case-insensitively.
      query: "racheté, m&a",
      leadIds: ["lead-1", "lead-2"],
    });

    expect(out.matched.map((m: any) => m.lead_id).sort()).toEqual(["lead-1", "lead-2"]);
  });

  it("no matches — returns empty matched[], scanned_count correct, no throw", async () => {
    mockHttp([
      webFetch("lead-1", { "📈 signals": [{ description: "nothing relevant", source: "s" }] }),
    ]);

    const out: any = await scanPortfolioSignals.execute(newClient(), {
      query: "acquisition",
      leadIds: ["lead-1"],
    });

    expect(out.matched).toHaveLength(0);
    expect(out.matched_count).toBe(0);
    expect(out.scanned_count).toBe(1);
    expect(out.not_researched).toHaveLength(0);
  });

  it("429 mid-scan — partial matched preserved, quota_exceeded true", async () => {
    mockHttp([
      webFetch("lead-1", {
        "📈 signals": [{ description: "acquired a startup", source: "s", date: "2025-03-01" }],
      }),
      {
        method: "GET",
        path: "/1.5/leads/lead-2/web_fetch",
        status: 429,
        body: { code: "QUOTA_EXCEEDED" },
      },
    ]);

    const out: any = await scanPortfolioSignals.execute(newClient(), {
      query: "acquired",
      leadIds: ["lead-1", "lead-2"],
    });

    expect(out.quota_exceeded).toBe(true);
    expect(out.matched.map((m: any) => m.lead_id)).toEqual(["lead-1"]);
    expect(out.matched_count).toBe(1);
    // lead-2 failed to read → surfaced as not_researched, never silently
    // dropped nor falsely "no match" (issue #3704 honesty invariant).
    expect(out.not_researched.map((n: any) => n.lead_id)).toEqual(["lead-2"]);
    // scanned_count = matched + non-matching + not_researched holds.
    expect(out.scanned_count).toBe(2);
  });

  it("non-quota read failure (404) — lead surfaces as not_researched, not silently dropped", async () => {
    mockHttp([
      webFetch("lead-1", {
        "📈 signals": [{ description: "acquired a startup", source: "s", date: "2025-03-01" }],
      }),
      {
        method: "GET",
        path: "/1.5/leads/lead-2/web_fetch",
        status: 404,
        body: { code: "NOT_FOUND" },
      },
    ]);

    const out: any = await scanPortfolioSignals.execute(newClient(), {
      query: "acquired",
      leadIds: ["lead-1", "lead-2"],
    });

    // A 404 is not a quota wall — but the lead still couldn't be read, so it
    // must land in not_researched (honest coverage), and scanned_count must
    // still account for it.
    expect(out.quota_exceeded).toBe(false);
    expect(out.matched.map((m: any) => m.lead_id)).toEqual(["lead-1"]);
    expect(out.not_researched.map((n: any) => n.lead_id)).toEqual(["lead-2"]);
    expect(out.scanned_count).toBe(2);
  });

  it("max_leads cap — truncated_at is set when leadIds exceed the cap", async () => {
    mockHttp([
      webFetch("lead-1", { "📈 signals": [{ description: "acquired co", source: "s", date: "2025-03-01" }] }),
    ]);

    const out: any = await scanPortfolioSignals.execute(newClient(), {
      query: "acquired",
      leadIds: ["lead-1", "lead-2", "lead-3"],
      max_leads: 1,
    });

    expect(out.truncated_at).toBe(1);
    expect(out.scanned_count).toBe(1);
  });

  it("Monitor scope (city) — resolves geo, filters, paginates /monitor, then bulk-reads web_fetch", async () => {
    mockHttp([
      // 1. geo resolve — exact-name match on "Lyon" short-circuits ambiguity.
      {
        method: "GET",
        path: "/1.5/geo/search?q=Lyon",
        status: 200,
        body: { results: [{ id: "geo-lyon", name: "Lyon", country: "FR", level: 5 }] },
      },
      // 2. store the filter (location_ids merged from the resolved geo id).
      { method: "POST", path: "/1.5/monitor/filter", status: 200, body: {} },
      // 3. one short page of the portfolio — carries id/name/location.
      {
        method: "GET",
        path: /^\/1\.5\/monitor\?/,
        status: 200,
        body: {
          items: [
            { id: "lead-1", name: "Acme SARL", location: { city: "Lyon", state: "ARA" } },
            { id: "lead-2", name: "Beta SA", location: "Lyon, ARA" },
          ],
          pagination: { pages: 1 },
        },
      },
      // 4. per-lead cached signal reads.
      webFetch("lead-1", {
        "📈 business signals": [
          { description: "Acme racheté par un groupe US", source: "lesechos.fr", date: "2025-03-01", hot: true },
        ],
      }),
      webFetch("lead-2", {
        "📈 business signals": [{ description: "embauche 10 personnes", source: "x", date: "2025-02-01" }],
      }),
    ]);

    const out: any = await scanPortfolioSignals.execute(newClient(), {
      query: "racheté, acquisition",
      city: "Lyon",
    });

    expect(out.matched.map((m: any) => m.lead_id)).toEqual(["lead-1"]);
    // name + location carried through from the Monitor page.
    expect(out.matched[0].name).toBe("Acme SARL");
    expect(out.matched[0].location).toBe("Lyon, ARA");
    expect(out.scanned_count).toBe(2);

    const reqs = getHttpRequests();
    // The filter was stored (POST) and /monitor was queried with filtered=true.
    expect(reqs.some((r) => r.method === "POST" && r.path === "/1.5/monitor/filter")).toBe(true);
    const monitorReq = reqs.find((r) => r.method === "GET" && r.path.startsWith("/1.5/monitor?"));
    expect(monitorReq?.path).toContain("filtered=true");
  });

  it("429 while paging /monitor — sets quota_exceeded so the agent reports 'incomplete', not 'no matches'", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.5/geo/search?q=Lyon",
        status: 200,
        body: { results: [{ id: "geo-lyon", name: "Lyon", country: "FR", level: 5 }] },
      },
      { method: "POST", path: "/1.5/monitor/filter", status: 200, body: {} },
      // The portfolio enumeration itself hits the quota wall.
      {
        method: "GET",
        path: /^\/1\.5\/monitor\?/,
        status: 429,
        body: { code: "QUOTA_EXCEEDED" },
      },
    ]);

    const out: any = await scanPortfolioSignals.execute(newClient(), {
      query: "acquired",
      city: "Lyon",
    });

    // Could not enumerate the portfolio → honest partial coverage, NOT a
    // confident empty result.
    expect(out.quota_exceeded).toBe(true);
    expect(out.matched).toHaveLength(0);
    expect(out.scanned_count).toBe(0);
  });

  it("filter POST fails — falls back to an UNfiltered scan (filtered=false), never trusts a stale server-side filter", async () => {
    mockHttp([
      // Storing the filter fails (server error).
      { method: "POST", path: "/1.5/monitor/filter", status: 500, body: { code: "SERVER_ERROR" } },
      // The /monitor read must go out UNfiltered to avoid a stale cohort.
      {
        method: "GET",
        path: /^\/1\.5\/monitor\?/,
        status: 200,
        body: { items: [{ id: "lead-1", name: "Acme", location: "Paris" }], pagination: { pages: 1 } },
      },
      webFetch("lead-1", {
        "📈 signals": [{ description: "acquired a rival", source: "s", date: "2025-03-01" }],
      }),
    ]);

    const out: any = await scanPortfolioSignals.execute(newClient(), {
      query: "acquired",
      set_filter: { criteria: [{ type: "sector_ids", is_excluded: false, sectors: ["x"] }] } as any,
    });

    expect(out.matched.map((m: any) => m.lead_id)).toEqual(["lead-1"]);
    const monitorReq = getHttpRequests().find(
      (r) => r.method === "GET" && r.path.startsWith("/1.5/monitor?")
    );
    // The store failed, so the read must NOT claim filtered=true.
    expect(monitorReq?.path).toContain("filtered=false");
  });

  it("ambiguous city — returns status:'ambiguous_locations' and issues no /monitor or web_fetch calls", async () => {
    mockHttp([
      // Two close-scoring prefix matches, neither an exact-name win → ambiguous.
      {
        method: "GET",
        path: "/1.5/geo/search?q=Springfield",
        status: 200,
        body: {
          results: [
            { id: "geo-il", name: "Springfield township", country: "US", level: 8 },
            { id: "geo-mo", name: "Springfield village", country: "US", level: 8 },
          ],
        },
      },
    ]);

    const out: any = await scanPortfolioSignals.execute(newClient(), {
      query: "acquired",
      city: "Springfield",
    });

    expect(out.status).toBe("ambiguous_locations");
    expect(out.location_ambiguities.length).toBeGreaterThan(0);
    expect(out.scanned_count).toBe(0);
    expect(out.matched).toHaveLength(0);

    const reqs = getHttpRequests();
    expect(reqs.some((r) => r.path.includes("/monitor"))).toBe(false);
    expect(reqs.some((r) => r.path.includes("/web_fetch"))).toBe(false);
  });

  it("empty/whitespace query — matches nothing (no false positives)", async () => {
    mockHttp([
      webFetch("lead-1", { "📈 signals": [{ description: "acquired co", source: "s" }] }),
    ]);

    const out: any = await scanPortfolioSignals.execute(newClient(), {
      query: "   ",
      leadIds: ["lead-1"],
    });

    expect(out.matched).toHaveLength(0);
    expect(out.scanned_count).toBe(1);
  });
});
