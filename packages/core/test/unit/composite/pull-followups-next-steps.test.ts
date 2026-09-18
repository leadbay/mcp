import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { pullFollowups } from "../../../src/composite/pull-followups.js";

// pull_followups relied on its description's snippet table to suggest the call
// board — a row the model picks from a dozen, or does not. next_steps is mapped
// into the host widget verbatim and in order, so the artifact offer fires every
// time. Same guarantee pull_leads already has.

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

const lead = (id: string) => ({ id, name: `Lead ${id}`, in_monitor: true });

/**
 * The composite fires TWO reads in parallel: the monitor page and, separately,
 * `GET /monitor/filter` for the stored FilterItem. `active_filters` comes from
 * the second — declaring only the first leaves it null and the filter-aware
 * branches never fire.
 */
function replies(opts: {
  leads?: number;
  page?: number;
  pages?: number;
  criteria?: unknown[];
}) {
  const n = opts.leads ?? 3;
  return [
    {
      method: "GET" as const,
      path: "/1.6/monitor/filter",
      status: 200,
      body: opts.criteria ? { criteria: opts.criteria } : { criteria: [] },
    },
    {
      // The composite appends a query string, so match the path by pattern —
      // a literal never matches.
      method: "GET" as const,
      path: /\/1\.6\/monitor\?/,
      status: 200,
      body: {
        leads: Array.from({ length: n }, (_, i) => lead(String(i))),
        pagination: { page: opts.page ?? 0, pages: opts.pages ?? 1, total: n },
      },
    },
  ];
}

beforeEach(() => resetHttpMock());

describe("leadbay_pull_followups NEXT STEPS", () => {
  it("puts the artifact offer FIRST on a non-empty page", async () => {
    mockHttp(replies({ leads: 3 }));
    const r = (await pullFollowups.execute(newClient(), {})) as {
      next_steps: { options: Array<{ label: string; kind: string }> };
    };
    expect(r.next_steps.options[0].kind).toBe("build_artifact");
    expect(r.next_steps.options[0].label).toBe("Call board");
  });

  it("names it a CALL board, not a triage board", async () => {
    // A Monitor lead has been seen and worked already: the action is logging
    // outreach, not deciding taste.
    mockHttp(replies({ leads: 3 }));
    const r = (await pullFollowups.execute(newClient(), {})) as {
      next_steps: { options: Array<{ description: string }> };
    };
    expect(r.next_steps.options[0].description).toMatch(/log outreach/i);
    expect(r.next_steps.options[0].description).not.toMatch(/triage/i);
  });

  it("offers nothing when the page is empty", async () => {
    // An offer to work zero leads is noise.
    mockHttp(replies({ leads: 0 }));
    const r = (await pullFollowups.execute(newClient(), {})) as { next_steps: unknown };
    expect(r.next_steps).toBeNull();
  });

  it("offers the next page only when one exists", async () => {
    mockHttp(replies({ leads: 3, page: 0, pages: 4 }));
    const more = (await pullFollowups.execute(newClient(), {})) as {
      next_steps: { options: Array<{ kind: string; description: string }> };
    };
    const nextOpt = more.next_steps.options.find((o) => o.kind === "pull_next_page");
    expect(nextOpt?.description).toContain("page 2");

    resetHttpMock();
    mockHttp(replies({ leads: 3, page: 0, pages: 1 }));
    const last = (await pullFollowups.execute(newClient(), {})) as {
      next_steps: { options: Array<{ kind: string }> };
    };
    expect(last.next_steps.options.some((o) => o.kind === "pull_next_page")).toBe(false);
  });

  it("still offers coverage when a filter is narrowing the view, reframed", async () => {
    // This once asserted the opposite, on the reasoning that measuring "how much
    // sits in sector X" while looking at sector X is circular. In practice the
    // gate suppressed the offer far more often than intended: the Monitor filter
    // is server-stored and survives sessions, so an account that filtered once
    // never saw the board again. A filter changes the QUESTION the board should
    // answer — this slice against the whole book — rather than making it moot.
    mockHttp(replies({ leads: 3, criteria: [{ type: "sector_ids", sectors: ["5134"] }] }));
    const r = (await pullFollowups.execute(newClient(), {})) as {
      next_steps: { options: Array<{ label: string; description: string }> };
    };
    const coverage = r.next_steps.options.find((o) => o.label === "Coverage board");
    expect(coverage).toBeDefined();
    // The wording must tell the agent the denominator has to be measured
    // unfiltered, or it reports the slice as though it were the whole book.
    expect(coverage!.description).toMatch(/unfiltered/i);
  });

  it("offers coverage when nothing is filtered yet", async () => {
    mockHttp(replies({ leads: 3, criteria: [] }));
    const r = (await pullFollowups.execute(newClient(), {})) as {
      next_steps: { options: Array<{ label: string }> };
    };
    expect(r.next_steps.options.some((o) => o.label === "Coverage board")).toBe(true);
  });

  it("offers TWO distinct artifacts, each describing which board it builds", async () => {
    // The call board is one card per lead; the coverage board is tiles, bars
    // and a table over the whole portfolio. Both are build_artifact, so the
    // description is the only thing telling the agent which to build —
    // identical wording would make the choice a coin flip.
    mockHttp(replies({ leads: 3, criteria: [] }));
    const r = (await pullFollowups.execute(newClient(), {})) as {
      next_steps: { options: Array<{ label: string; description: string; kind: string }> };
    };
    const artifacts = r.next_steps.options.filter((o) => o.kind === "build_artifact");
    expect(artifacts).toHaveLength(2);
    expect(artifacts[0].description).toMatch(/log outreach/i);
    expect(artifacts[1].description).toMatch(/sector or city/i);
    expect(artifacts[0].description).not.toBe(artifacts[1].description);
    expect(artifacts[0].label).not.toBe(artifacts[1].label);
  });

  it("never exceeds the widget's four-option cap", async () => {
    mockHttp(replies({ leads: 3, page: 0, pages: 9, criteria: [] }));
    const r = (await pullFollowups.execute(newClient(), {})) as {
      next_steps: { options: unknown[] };
    };
    expect(r.next_steps.options.length).toBeLessThanOrEqual(4);
    expect(r.next_steps.options.length).toBeGreaterThanOrEqual(2);
  });

  it("every option carries label, description and kind", async () => {
    mockHttp(replies({ leads: 3 }));
    const r = (await pullFollowups.execute(newClient(), {})) as {
      next_steps: { question: string; options: Array<Record<string, string>> };
    };
    expect(r.next_steps.question).toBeTruthy();
    for (const o of r.next_steps.options) {
      expect(o.label).toBeTruthy();
      expect(o.description).toBeTruthy();
      expect(o.kind).toBeTruthy();
      // Labels are the button text on AskUserQuestion — five words at most.
      expect(o.label.split(/\s+/).length).toBeLessThanOrEqual(5);
    }
  });
});
