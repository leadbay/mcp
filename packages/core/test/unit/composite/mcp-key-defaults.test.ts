/**
 * Idempotency-key canonicalization edge cases on the MCP-first delivery tools.
 *
 * Both are ways a retry of the SAME approved work derives a DIFFERENT key and
 * so escapes backend dedupe into a second paid, novelty-claiming job:
 *
 * 1. `exploration_cap` omitted vs. passed as its documented default min(3n,150).
 *    Every other defaulted field (min_ai_score, novelty, title_gate) is already
 *    canonicalized to the value the backend will apply; this one was not.
 * 2. A blank `request_id`. It is schema-`required` on the search, but args are
 *    not validated before dispatch, so `""` reached `??` as an "explicit" value
 *    and shipped as the key. If the backend reads blank as absent a retry
 *    double-spends; if it reads blank as a key, unrelated approvals dedupe onto
 *    each other.
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

beforeEach(() => resetHttpMock());

/** Confirmed PAID search — the only path that derives a key. */
async function searchBody(extra: Record<string, unknown>): Promise<any> {
  mockHttp([
    {
      method: "POST",
      path: "/1.6/mcp/search",
      status: 200,
      body: { job_id: "job-1", state: "queued", items: [] },
    },
    {
      method: "GET",
      path: /^\/1\.6\/mcp\/jobs\//,
      status: 200,
      body: {
        job: { id: "job-1", state: "succeeded" },
        funnel: { delivered: 0, examined: 0 },
        items: [],
      },
    },
  ]);
  await findNewLeads.execute(newClient(), {
    example_lead: { description: "independent gym, 2 sites" },
    count: 10,
    qualify: true,
    confirm: true,
    wait_seconds: 0,
    ...extra,
  } as any);
  const post = getHttpRequests().find(
    (r) => r.method === "POST" && r.path.endsWith("/mcp/search")
  );
  return JSON.parse(post!.body ?? "{}");
}

describe("leadbay_find_new_leads — key canonicalization", () => {
  it("an omitted exploration_cap keys the same as its documented default", async () => {
    // count: 10 → min(3*10, 150) = 30
    const omitted = await searchBody({});
    const explicit = await searchBody({ exploration_cap: 30 });
    expect(omitted.request_id).toBeTruthy();
    expect(omitted.request_id).toEqual(explicit.request_id);
  });

  it("an explicit NON-default exploration_cap still keys distinctly", async () => {
    const omitted = await searchBody({});
    const raised = await searchBody({ exploration_cap: 120 });
    expect(omitted.request_id).not.toEqual(raised.request_id);
  });

  it("the default tracks count rather than being a fixed number", async () => {
    // count: 40 → min(120, 150) = 120, so 120 must match the omitted key here
    // while 30 (the count:10 default) must not.
    const omitted = await searchBody({ count: 40 });
    const matching = await searchBody({ count: 40, exploration_cap: 120 });
    const other = await searchBody({ count: 40, exploration_cap: 30 });
    expect(omitted.request_id).toEqual(matching.request_id);
    expect(omitted.request_id).not.toEqual(other.request_id);
  });

  it("the cap is capped at 150 for large counts", async () => {
    // count: 50 → min(150, 150) = 150
    const omitted = await searchBody({ count: 50 });
    const explicit = await searchBody({ count: 50, exploration_cap: 150 });
    expect(omitted.request_id).toEqual(explicit.request_id);
  });

  it("a blank request_id falls back to the derived key", async () => {
    const blank = await searchBody({ request_id: "   " });
    const missing = await searchBody({});
    expect(blank.request_id).toBeTruthy();
    expect(blank.request_id.trim()).not.toEqual("");
    expect(blank.request_id).toEqual(missing.request_id);
  });

  it("a real request_id is still honoured, trimmed", async () => {
    const keyed = await searchBody({ request_id: "  gyms-texas-2026-07-28  " });
    expect(keyed.request_id).toEqual("gyms-texas-2026-07-28");
  });
});
