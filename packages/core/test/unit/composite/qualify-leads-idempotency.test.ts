/**
 * Derived idempotency key for a consented paid qualify batch.
 *
 * `request_id` is optional on this tool, so a paid submit without one could be
 * re-run by any timeout or agent retry and re-charge qualification + channel
 * purchases for the same refs. The derived key must therefore be a function of
 * the APPROVED BATCH and nothing else — in particular not of the clock, so a
 * retry that lands after midnight still dedupes.
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
import { qualifyLeads } from "../../../src/composite/qualify-leads.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.tok", "us");
const JOB_ID = "b1f0e7c4-2a56-4d80-9c33-5e6f1a2b3c4d";

const SUBMIT_202 = {
  job_id: JOB_ID,
  status_url: `/1.6/mcp/jobs/${JOB_ID}`,
  estimated_cost: { max: 238, unit: "cost_cents" },
  items_requested: 2,
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

async function submittedRequestId(params: Record<string, unknown>) {
  resetHttpMock();
  mockHttp([
    { method: "POST", path: "/1.6/mcp/qualify", status: 202, body: SUBMIT_202 },
    {
      method: "GET",
      path: `/1.6/mcp/jobs/${JOB_ID}?limit=100`,
      status: 200,
      body: SNAPSHOT,
    },
  ]);
  await qualifyLeads.execute(newClient(), {
    confirm: true,
    wait_seconds: 0,
    ...params,
  } as any);
  const post = getHttpRequests().find((r: any) => r.method === "POST")!;
  return JSON.parse(post.body!).request_id as string;
}

const REFS = [{ website: "a.com" }, { website: "b.com" }];

describe("qualify_leads — derived idempotency key", () => {
  it("sends a derived request_id when a paid call omits one", async () => {
    const id = await submittedRequestId({ lead_refs: REFS });
    expect(id).toMatch(/^qualify-auto-[0-9a-f]{8}$/);
  });

  it("is stable across identical retries", async () => {
    const a = await submittedRequestId({ lead_refs: REFS });
    const b = await submittedRequestId({ lead_refs: REFS });
    expect(a).toBe(b);
  });

  it("does not depend on the clock (a retry after midnight still dedupes)", async () => {
    const a = await submittedRequestId({ lead_refs: REFS });
    // Shift the wall clock past a UTC midnight WITHOUT faking timers — fake
    // timers would stall the awaited HTTP mock. Stubbing Date.now + the Date
    // constructor is enough to catch any date component in the hash.
    const RealDate = Date;
    const shifted = new RealDate("2031-03-04T00:00:01Z").getTime();
    // @ts-expect-error — deliberate narrow stub for this assertion
    globalThis.Date = class extends RealDate {
      constructor(...args: any[]) {
        // @ts-expect-error — passthrough
        super(...(args.length ? args : [shifted]));
      }
      static now() {
        return shifted;
      }
    };
    try {
      const b = await submittedRequestId({ lead_refs: REFS });
      expect(b).toBe(a);
    } finally {
      globalThis.Date = RealDate;
    }
  });

  it("ref order does not change the key", async () => {
    const a = await submittedRequestId({ lead_refs: REFS });
    const b = await submittedRequestId({ lead_refs: [...REFS].reverse() });
    expect(a).toBe(b);
  });

  it("a raised max_cost is a NEW approved run", async () => {
    const capped = await submittedRequestId({ lead_refs: REFS, max_cost: 500 });
    const raised = await submittedRequestId({ lead_refs: REFS, max_cost: 5000 });
    expect(raised).not.toBe(capped);
  });

  it("different channels key differently", async () => {
    const email = await submittedRequestId({ lead_refs: REFS, channels: ["email"] });
    const phone = await submittedRequestId({ lead_refs: REFS, channels: ["phone"] });
    expect(email).not.toBe(phone);
  });

  it("different prior_deliveries slices key differently", async () => {
    const first = await submittedRequestId({
      prior_deliveries: { job_id: "j1", limit: 50 },
    });
    const next = await submittedRequestId({
      prior_deliveries: { job_id: "j1", limit: 50, since: "cursor-50" },
    });
    expect(next).not.toBe(first);
  });

  it("an explicit request_id always wins", async () => {
    const id = await submittedRequestId({ lead_refs: REFS, request_id: "mine-1" });
    expect(id).toBe("mine-1");
  });
});
