/**
 * `lead_refs` is capped at 500 in CODE, not just in prose.
 *
 * The tool description says "max 500", the schema carries no `maxItems`, and
 * `rejectMalformedLeadRefs` only inspects shape — so an oversized batch used to
 * sail through validation and reach a real `POST /mcp/qualify`, where the
 * caller got an opaque backend 400 instead of the fast named rejection the
 * sibling case (`rejectOversizedExclusions` on `exclude_lead_ids`) already
 * gives. On a paid batch that round-trip is the difference between a clear
 * "split it" and an unexplained failure after the spend decision.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory, getHttpRequests } from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { qualifyLeads } from "../../../src/composite/qualify-leads.js";
import { MAX_LEAD_REFS } from "../../../src/composite/_mcp-job-helpers.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.tok", "us");
const refs = (n: number, prefix = "lead") =>
  Array.from({ length: n }, (_, i) => ({ lead_id: `${prefix}-${i}` }));

beforeEach(() => resetHttpMock());

describe("leadbay_qualify_leads — the 500-ref ceiling is enforced", () => {
  it("refuses an oversized batch before any request reaches the wire", async () => {
    mockHttp([]);
    await expect(
      qualifyLeads.execute(newClient(), {
        lead_refs: refs(MAX_LEAD_REFS + 1),
        qualify: false,
        request_id: "cap-1",
      } as any)
    ).rejects.toMatchObject({ code: "TOO_MANY_LEAD_REFS" });
    // The point: no quote, no submit, nothing billable attempted.
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("names the count and the ceiling, and says how to proceed", async () => {
    mockHttp([]);
    const err: any = await qualifyLeads
      .execute(newClient(), {
        lead_refs: refs(750),
        qualify: false,
        request_id: "cap-2",
      } as any)
      .catch((e) => e);
    expect(err.message).toContain("750");
    expect(err.message).toContain(String(MAX_LEAD_REFS));
    expect(err.hint).toMatch(/own request_id/i);
  });

  it("counts DE-DUPLICATED companies — duplicates collapse server-side", async () => {
    // 600 entries, 300 distinct. The backend would fold them to 300 items, so
    // refusing this would reject work it would happily have done.
    mockHttp([
      {
        method: "POST",
        path: "/1.6/mcp/qualify",
        status: 200,
        body: { job_id: "job-1", items_requested: 300 },
      },
      {
        method: "GET",
        path: /^\/1\.6\/mcp\/jobs\//,
        status: 200,
        body: {
          job: { id: "job-1", state: "completed" },
          funnel: { delivered: 0, resolved: 300 },
          items: [],
          next_since: null,
          cost: { spent: 0, unit: "cost_cents", breakdown: {} },
          explain: { region: "us", model: "m" },
        },
      },
    ]);
    const doubled = [...refs(300), ...refs(300)];
    const res: any = await qualifyLeads.execute(newClient(), {
      lead_refs: doubled,
      qualify: false,
      request_id: "cap-3",
      wait_seconds: 0,
    } as any);
    expect(res.job_id).toBe("job-1");
  });

  it("lets the exact ceiling through", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.6/mcp/qualify",
        status: 200,
        body: { job_id: "job-2", items_requested: MAX_LEAD_REFS },
      },
      {
        method: "GET",
        path: /^\/1\.6\/mcp\/jobs\//,
        status: 200,
        body: {
          job: { id: "job-2", state: "completed" },
          funnel: { delivered: 0, resolved: MAX_LEAD_REFS },
          items: [],
          next_since: null,
          cost: { spent: 0, unit: "cost_cents", breakdown: {} },
          explain: { region: "us", model: "m" },
        },
      },
    ]);
    const res: any = await qualifyLeads.execute(newClient(), {
      lead_refs: refs(MAX_LEAD_REFS),
      qualify: false,
      request_id: "cap-4",
      wait_seconds: 0,
    } as any);
    expect(res.job_id).toBe("job-2");
  });
});
