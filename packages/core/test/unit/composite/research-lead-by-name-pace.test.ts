/**
 * product#4177 — a list looked up one company at a time is told to stop.
 *
 * FR prod, 2026-09-14: one agent called leadbay_research_lead_by_name_fuzzy
 * 4,026 times in 84 minutes over a pasted list of brokers, 3,929 of them in
 * one hour, and no answer said the list goes in one call. Research routines
 * reach 256 lookups in 10 minutes and 470 in an hour. These tests replay both:
 * no notice up to 19, a notice from the 20th, a routine's busiest hour never
 * refused, a refusal past 1,000 in an hour that reaches no backend route, and
 * lookups again once the hour passes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getHttpRequests,
  httpsMockFactory,
  mockHttp,
  resetHttpMock,
} from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { researchLeadByNameFuzzy } from "../../../src/composite/research-lead-by-name-fuzzy.js";

const BASE = "https://api-fr.leadbay.app";
// One token per test: the count is kept per caller for the life of the process.
let token = 0;
const newCaller = () => {
  const t = `u.pace-${++token}`;
  return () => new LeadbayClient(BASE, t, "fr");
};

const broker = (i: number) => `Courtier Assurances ${i}`;

// Neither the user's leads nor the registry has the company.
function misses(from: number, to: number) {
  const scripts = [];
  for (let i = from; i <= to; i++) {
    scripts.push(
      {
        method: "GET" as const,
        path: `/1.6/search/suggest?q=${encodeURIComponent(broker(i))}`,
        status: 200,
        body: [],
      },
      {
        method: "POST" as const,
        path: "/1.6/leads/resolve",
        status: 200,
        body: { type: "none", would_help: ["website"] },
      }
    );
  }
  return scripts;
}

const T0 = new Date("2026-09-14T13:06:32Z").getTime();

beforeEach(() => {
  resetHttpMock();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});

afterEach(() => vi.useRealTimers());

describe("research_lead_by_name_fuzzy — pace (product#4177)", () => {
  it("answers 19 lookups as before, adds a notice from the 20th, refuses the 1,001st in an hour", async () => {
    const client = newCaller();
    mockHttp(misses(1, 1000));

    const answers: any[] = [];
    for (let i = 1; i <= 1000; i++) {
      vi.setSystemTime(T0 + i * 1000);
      answers.push(
        await researchLeadByNameFuzzy.execute(client(), { companyName: broker(i) })
      );
    }

    expect(answers.every((a) => a.resolution === "not_found")).toBe(true);
    expect(answers.slice(0, 19).some((a) => "notice" in a)).toBe(false);
    expect(answers[19].notice).toContain(
      "Lookup 20 by name in the last 10 minutes, 20 not found."
    );
    expect(answers[19].notice).toContain("leadbay_qualify_leads");
    expect(answers[19].notice).toContain("qualify:false");
    expect(answers[19].notice).toContain("If they need each company's research card, carry on.");
    // One lookup a second: the notice counts the last 10 minutes only.
    expect(answers[999].notice).toContain("Lookup 600 by name");

    const before = getHttpRequests().length;
    vi.setSystemTime(T0 + 1001 * 1000);
    const refused = await researchLeadByNameFuzzy
      .execute(client(), { companyName: broker(1001) })
      .catch((e) => e);

    expect(refused.code).toBe("TOO_MANY_LOOKUPS");
    expect(refused.message).toBe(
      "1000 companies were looked up by name in the last hour, 1000 of them not found. This tool takes another lookup in 2600 seconds"
    );
    expect(refused.hint).toContain("Stop calling this tool once per company");
    expect(refused.hint).toContain("leadbay_qualify_leads");
    expect(refused._meta.retry_after).toBe(2600);
    expect(getHttpRequests().length).toBe(before);
  });

  it("never refuses the busiest research hour on record: 225 in 10 minutes, 305 in the hour", async () => {
    // nlevasseur@homespirit.fr, research_lead_by_id, 2026-05-28/29.
    const client = newCaller();
    mockHttp(misses(1, 305));
    const settled = [];
    for (let i = 1; i <= 305; i++) {
      vi.setSystemTime(T0 + (i <= 225 ? i * 2 : 450 + (i - 225) * 40) * 1000);
      settled.push(
        await researchLeadByNameFuzzy
          .execute(client(), { companyName: broker(i) })
          .then(() => "answered", (e) => e.code)
      );
    }

    expect(settled.filter((s) => s === "answered")).toHaveLength(305);
  });

  it("takes lookups again once the oldest leaves the hour", async () => {
    const client = newCaller();
    mockHttp(misses(1, 1001));
    for (let i = 1; i <= 1000; i++) {
      await researchLeadByNameFuzzy.execute(client(), { companyName: broker(i) });
    }
    await expect(
      researchLeadByNameFuzzy.execute(client(), { companyName: broker(1001) })
    ).rejects.toMatchObject({ code: "TOO_MANY_LOOKUPS" });

    vi.setSystemTime(T0 + 60 * 60 * 1000);
    const again: any = await researchLeadByNameFuzzy.execute(client(), {
      companyName: broker(1001),
    });

    expect(again.resolution).toBe("not_found");
    expect(again.notice).toBeUndefined();
  });

  it("1,001 lookups sent at once: 1,000 answered, 1 refused before reaching the backend", async () => {
    const client = newCaller();
    mockHttp(misses(1, 1001));

    const settled = await Promise.allSettled(
      Array.from({ length: 1001 }, (_, i) =>
        researchLeadByNameFuzzy.execute(client(), { companyName: broker(i + 1) })
      )
    );

    const refused = settled.filter((s) => s.status === "rejected");
    expect(settled.length - refused.length).toBe(1000);
    expect(refused.map((s: any) => s.reason.code)).toEqual(["TOO_MANY_LOOKUPS"]);
    expect(
      getHttpRequests().filter((r) => r.path === "/1.6/leads/resolve")
    ).toHaveLength(1000);
  });

  it("counts each caller on its own", async () => {
    const first = newCaller();
    const second = newCaller();
    mockHttp(misses(1, 1001));
    for (let i = 1; i <= 1000; i++) {
      await researchLeadByNameFuzzy.execute(first(), { companyName: broker(i) });
    }

    const other: any = await researchLeadByNameFuzzy.execute(second(), {
      companyName: broker(1001),
    });

    expect(other.resolution).toBe("not_found");
    expect(other.notice).toBeUndefined();
  });

  it("puts the notice at the top of a markdown research card", async () => {
    const client = newCaller();
    const LENS = 40005;
    const LEAD = "11111111-2222-3333-4444-555555555555";
    mockHttp([
      ...misses(1, 19),
      {
        method: "GET",
        path: `/1.6/lenses/${LENS}/leads/wishlist?q=${encodeURIComponent("Acme")}&count=50&page=0&contacts=false`,
        status: 200,
        body: { items: [{ id: LEAD, name: "Acme", score: 80 }] },
      },
      { method: "POST", path: "/1.6/interactions", status: 200, body: {} },
      {
        method: "GET",
        path: `/1.6/lenses/${LENS}/leads/${LEAD}`,
        status: 200,
        body: {
          id: LEAD,
          name: "Acme",
          score: 80,
          ai_agent_lead_score: 70,
          location: null,
          description: null,
          size: null,
          website: "acme.example",
          tags: [],
          keywords: [],
          notes_count: 0,
          epilogue_actions_count: 0,
          prospecting_actions_count: 0,
          org_contacts_count: 0,
          liked: false,
          disliked: false,
          new: false,
          recommended_contact: null,
        },
      },
      { method: "GET", path: `/1.6/leads/${LEAD}/ai_agent_responses`, status: 200, body: [] },
      { method: "GET", path: `/1.6/leads/${LEAD}/enrich/contacts?IncludeEnriched=true`, status: 200, body: [] },
      { method: "GET", path: `/1.6/leads/${LEAD}/web_fetch`, status: 200, body: { content: null, fetch_at: null } },
      {
        method: "GET",
        path: `/1.6/leads/${LEAD}/activities?count=20`,
        status: 200,
        body: { items: [], pagination: { page: 0, pages: 1, total: 0 } },
      },
      { method: "GET", path: `/1.6/leads/${LEAD}/contacts?IncludeEnriched=true`, status: 200, body: [] },
    ]);
    for (let i = 1; i <= 19; i++) {
      await researchLeadByNameFuzzy.execute(client(), { companyName: broker(i) });
    }

    const card: any = await researchLeadByNameFuzzy.execute(client(), {
      companyName: "Acme",
      lensId: LENS,
      response_format: "markdown",
    });

    expect(card.__markdown_envelope).toBe(true);
    expect(card.markdown).toMatch(
      /^> Lookup 20 by name in the last 10 minutes, 19 not found\./
    );
    expect(card.markdown).toContain("Acme");
    expect(card.structured.notice).toContain("Lookup 20 by name");
  });
});
