/**
 * Malformed exclusion ids are refused, not silently dropped.
 *
 * Once the submit body started sending `canonicalIdSet(exclude_lead_ids)`
 * rather than the raw array, a non-string entry stopped reaching the backend
 * at all: canonicalIdSet maps it to null and filters it. So a paid search ran
 * WITHOUT an exclusion the caller asked for, and could re-deliver — and
 * charge for — exactly the lead they were trying to skip. Blanks drop the
 * same way.
 *
 * That silent narrowing is the regression the wire fix introduced; refusing
 * the list keeps the caller's intent intact.
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
const UUID = "7b3c1de2-5f40-4a9c-9d21-0c8ea4f61b55";

beforeEach(() => resetHttpMock());

async function refusal(exclude_lead_ids: unknown) {
  mockHttp([]);
  try {
    await findNewLeads.execute(newClient(), {
      example_lead: { description: "independent gym" },
      count: 5,
      request_id: "excl-test",
      exclude_lead_ids,
      wait_seconds: 0,
    } as any);
    return null;
  } catch (e) {
    return e as { code?: string; message?: string; hint?: string };
  }
}

describe("leadbay_find_new_leads — malformed exclude_lead_ids", () => {
  it("refuses a numeric entry rather than dropping it", async () => {
    const e = await refusal([123, UUID]);
    expect(e!.code).toBe("INVALID_EXCLUDE_LEAD_ID");
    expect(e!.message).toMatch(/0 \(number\)/);
  });

  it("refuses null and blank entries", async () => {
    expect((await refusal([null]))!.message).toMatch(/0 \(null\)/);
    expect((await refusal(["   "]))!.message).toMatch(/0 \(blank\)/);
  });

  it("says why silence would be worse", async () => {
    // The hint has to carry the consequence: this is a PAID path and the
    // dropped exclusion is the lead the caller is trying not to pay for.
    const e = await refusal([123]);
    expect(e!.hint).toMatch(/charge|pay/i);
  });

  it("nothing reaches the wire", async () => {
    await refusal([123, UUID]);
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("still accepts a clean list", async () => {
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
      example_lead: { description: "independent gym" },
      count: 5,
      request_id: "excl-ok",
      exclude_lead_ids: [UUID],
      wait_seconds: 0,
    } as any);
    const post = getHttpRequests().find((r) => r.method === "POST");
    expect(JSON.parse(post!.body ?? "{}").exclude_lead_ids).toEqual([UUID]);
  });
});
