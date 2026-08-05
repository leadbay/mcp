/**
 * Derived idempotency key for a paid search without an explicit request_id.
 *
 * The invariant: EVERY field that goes into the POST body and changes what the
 * approved search does must also change the key. A field sent to the backend
 * but omitted from the hash means two genuinely different approved searches
 * collapse onto one job — the backend returns the first as a duplicate and the
 * difference (a narrowed filter, a new exclusion list) never takes effect.
 *
 * The last case below enforces that structurally, so a field added to the body
 * later cannot silently drift out of the key.
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
import { findNewLeads } from "../../../src/composite/find-new-leads.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.tok", "us");
const JOB_ID = "c4e8a1b2-77d3-4f60-9a11-3b5c7e2d9f08";

const SUBMIT_202 = {
  job_id: JOB_ID,
  status_url: `/1.6/mcp/jobs/${JOB_ID}`,
  estimated_cost: { max: 1880, unit: "cost_cents" },
  items_requested: 10,
  duplicate: false,
};

const SNAPSHOT = {
  job: { id: JOB_ID, state: "completed" },
  funnel: { delivered: 1 },
  items: [],
  cost: { spent: 0, unit: "cost_cents", breakdown: {} },
  next_since: null,
  explain: { region: "us", model: "m" },
};

beforeEach(() => resetHttpMock());

/** Submit a PAID search with no request_id and return the key that went out. */
async function keyFor(params: Record<string, unknown>) {
  resetHttpMock();
  mockHttp([
    { method: "POST", path: "/1.6/mcp/search", status: 202, body: SUBMIT_202 },
    {
      method: "GET",
      path: `/1.6/mcp/jobs/${JOB_ID}?limit=100`,
      status: 200,
      body: SNAPSHOT,
    },
  ]);
  await findNewLeads.execute(newClient(), {
    count: 10,
    qualify: true,
    confirm: true,
    wait_seconds: 0,
    ...params,
  } as any);
  const post = getHttpRequests().find((r: any) => r.method === "POST")!;
  return JSON.parse(post.body!).request_id as string;
}

describe("find_new_leads — derived search key", () => {
  it("is a 128-bit digest", async () => {
    expect(await keyFor({})).toMatch(/^search-auto-[0-9a-f]{32}$/);
  });

  it("is stable across identical retries", async () => {
    expect(await keyFor({})).toBe(await keyFor({}));
  });

  it("changes when exclude_lead_ids changes", async () => {
    // The top-up case: same ask, but avoiding what the first pass returned.
    const first = await keyFor({});
    const topUp = await keyFor({ exclude_lead_ids: ["lead-1", "lead-2"] });
    expect(topUp).not.toBe(first);

    const more = await keyFor({ exclude_lead_ids: ["lead-1", "lead-2", "lead-3"] });
    expect(more).not.toBe(topUp);
  });

  it("ignores exclude_lead_ids ORDER", async () => {
    const a = await keyFor({ exclude_lead_ids: ["lead-1", "lead-2"] });
    const b = await keyFor({ exclude_lead_ids: ["lead-2", "lead-1"] });
    expect(b).toBe(a);
  });

  // Passing a documented backend default explicitly must NOT fork the key —
  // otherwise a retry that materializes defaults launches a second paid job.
  it("treats omitted fields and their explicit defaults as the same search", async () => {
    const omitted = await keyFor({});
    expect(await keyFor({ novelty: "org" })).toBe(omitted);
    expect(await keyFor({ min_ai_score: 0 })).toBe(omitted);
    expect(await keyFor({ channels: [] })).toBe(omitted);
    expect(await keyFor({ exclude_lead_ids: [] })).toBe(omitted);

    // title_gate defaults to "prefer" only when contact_titles is set.
    const withTitles = await keyFor({ contact_titles: ["Owner"] });
    expect(await keyFor({ contact_titles: ["Owner"], title_gate: "prefer" })).toBe(
      withTitles
    );
  });

  it("a free-text value cannot forge a field boundary", async () => {
    const a = await keyFor({ query: 'x", "count": 99' });
    const b = await keyFor({ query: "x" });
    expect(a).not.toBe(b);
  });

  it("an explicit request_id always wins", async () => {
    expect(await keyFor({ request_id: "gyms-dallas-2026-08-05" })).toBe(
      "gyms-dallas-2026-08-05"
    );
  });

  // Structural guard: every body field that shapes the search must move the
  // key. `request_id` is the key itself and `dry_run` never submits, so both
  // are legitimately excluded.
  const SHAPING_FIELDS: Array<[string, unknown]> = [
    ["query", "gyms that buy flooring"],
    ["example_lead", { description: "an independent single-site gym" }],
    ["filters", { sectors: ["fitness"] }],
    ["count", 25],
    ["min_ai_score", -10],
    ["contact_titles", ["Owner"]],
    ["title_gate", "strict"],
    ["channels", ["email"]],
    ["exclude_lead_ids", ["lead-9"]],
    ["novelty", "none"],
    ["max_cost", 4200],
    ["exploration_cap", 90],
    ["lang", "fr"],
  ];

  for (const [field, value] of SHAPING_FIELDS) {
    it(`changes when ${field} changes`, async () => {
      const base = await keyFor({});
      const changed = await keyFor({ [field]: value });
      expect(
        changed,
        `${field} is sent to the backend but missing from the hashed shape`
      ).not.toBe(base);
    });
  }
});
