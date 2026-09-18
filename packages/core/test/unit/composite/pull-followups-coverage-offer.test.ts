import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { pullFollowups } from "../../../src/composite/pull-followups.js";

// The coverage board is the answer to "how well do we cover sector X" — but it
// only reaches a user if `pull_followups` offers it. It was gated on
// `!hasActiveFilter`, and the Monitor filter is SERVER-STORED and survives
// sessions: one real account had a sector filter left from an earlier session,
// so the offer was suppressed on every call indefinitely. The gate is gone; a
// filter now reframes the offer instead of withholding it.

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

type Opt = { label: string; description: string; kind: string };
type Result = { next_steps: { question: string; options: Opt[] } | null };

/** Monitor + stored-filter replies. The filter comes from a SEPARATE parallel
 *  call, so a mock that omits it never exercises the filtered branches. */
function replies(opts: { leads: number; criteria?: unknown[]; pages?: number }) {
  const items = Array.from({ length: opts.leads }, (_, i) => ({
    id: `lead-${i}`,
    name: `Co ${i}`,
    sector_id: "5134",
  }));
  return [
    {
      method: "GET" as const,
      path: /\/1\.6\/monitor\?/,
      status: 200,
      body: { items, pagination: { page: 0, pages: opts.pages ?? 1, total: opts.leads } },
    },
    {
      method: "GET" as const,
      path: /\/monitor\/filter/,
      status: 200,
      body: { criteria: opts.criteria ?? [] },
    },
  ];
}

const run = async (o: Parameters<typeof replies>[0]) => {
  mockHttp(replies(o));
  return (await pullFollowups.execute(newClient(), {})) as Result;
};

beforeEach(() => resetHttpMock());

describe("the coverage board is always on the menu", () => {
  it("is offered on an unfiltered view", async () => {
    const r = await run({ leads: 5 });
    expect(r.next_steps!.options.some((o) => o.label === "Coverage board")).toBe(true);
  });

  it("is offered on a FILTERED view too — a stale stored filter cannot hide it", async () => {
    const r = await run({ leads: 5, criteria: [{ type: "sector_ids", sectors: ["5152"] }] });
    expect(r.next_steps!.options.some((o) => o.label === "Coverage board")).toBe(true);
  });

  it("warns, when filtered, that the denominator must be measured unfiltered", async () => {
    // Without this the agent measures the slice against itself and reports 100%.
    const r = await run({ leads: 5, criteria: [{ type: "sector_ids", sectors: ["5152"] }] });
    const c = r.next_steps!.options.find((o) => o.label === "Coverage board")!;
    expect(c.description).toMatch(/unfiltered/i);
    expect(c.description).toMatch(/whole book/i);
  });

  it("does not carry that warning when nothing is filtered", async () => {
    const c = (await run({ leads: 5 })).next_steps!.options.find(
      (o) => o.label === "Coverage board",
    )!;
    expect(c.description).toMatch(/sector or city/i);
    expect(c.description).not.toMatch(/unfiltered/i);
  });

  it("survives the four-option cap even with a next page waiting", async () => {
    // Worst case: call board, prep outreach, coverage, next page. The coverage
    // offer must not be the one the slice drops.
    const r = await run({ leads: 20, pages: 5 });
    const labels = r.next_steps!.options.map((o) => o.label);
    expect(r.next_steps!.options.length).toBeLessThanOrEqual(4);
    expect(labels).toContain("Coverage board");
  });

  it("offers nothing at all on an empty page", async () => {
    // An offer to measure a book with no rows in it is noise.
    const r = await run({ leads: 0 });
    expect(r.next_steps).toBeNull();
  });

  it("stays distinguishable from the call board", async () => {
    // Both are build_artifact, so the description is the ONLY thing telling the
    // agent which of the two to build.
    const r = await run({ leads: 5 });
    const arts = r.next_steps!.options.filter((o) => o.kind === "build_artifact");
    expect(arts.length).toBe(2);
    expect(arts[0].description).not.toBe(arts[1].description);
    expect(arts[0].label).not.toBe(arts[1].label);
  });
});
