/**
 * The three flags that decide whether a user is charged are read as booleans,
 * never for truthiness, and never raw off the wire.
 *
 * Both holes were reproduced against production on 2026-09-08, on stdio and
 * hosted, on both regions:
 *
 *  - `qualify: "true"` — `server.ts`'s `findShapeMismatch` validates array and
 *    object shapes and leaves scalars alone on purpose, so the string arrived
 *    intact. `buysQualification = params.qualify === true` read it as FALSE,
 *    the gate never ran, and the body went to a backend whose Jackson mapper
 *    coerces `"true"` to `true`. A real job was submitted with no `confirm`
 *    and spent 94 cost_cents. At `count: 50` the same call quotes 5000.
 *
 *  - `dry_run: "false"` — truthy in JS, `false` to the backend. The dry-run
 *    branch returns BEFORE the spend gate, so the tool posted a real submit
 *    and answered `{dry_run: true}`, telling the agent nothing was spent.
 *
 * The unit suite was green through both, because every fixture passed a real
 * boolean. These cases pass the wire's types instead.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory, getHttpRequests } from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { findNewLeads } from "../../../src/composite/find-new-leads.js";
import { qualifyLeads } from "../../../src/composite/qualify-leads.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.tok", "us");

const QUOTE = {
  method: "POST" as const,
  path: /^\/1\.6\/mcp\/(search|qualify)$/,
  status: 200,
  body: {
    valid: true,
    items_requested: 3,
    estimated_cost: { max: 300, unit: "cost_cents" },
    quota_forecast: {},
  },
};
const bodies = () =>
  getHttpRequests().map((r) => (r.body ? JSON.parse(r.body) : {}));

beforeEach(() => resetHttpMock());

describe("find_new_leads — a string flag cannot buy anything", () => {
  it('qualify:"true" is PAID and is withheld without confirm', async () => {
    mockHttp([QUOTE]);
    const res: any = await findNewLeads.execute(newClient(), {
      filters: { employees_min: 10 },
      count: 3,
      qualify: "true",
      request_id: "flags-1",
    } as any);

    expect(res.mode).toBe("needs_confirmation");
    expect(res.submitted).toBe(false);
    expect(res.paid_because.join(" ")).toContain("qualify");
    // The ONE request allowed here is the free quote, and it must carry the
    // normalized boolean — not the string the caller sent.
    const sent = bodies();
    expect(sent).toHaveLength(1);
    expect(sent[0].dry_run).toBe(true);
    expect(sent[0].qualify).toBe(true);
  });

  it.each(["TRUE", "True", " true "])(
    'qualify:"%s" is normalized, not read as free',
    async (value) => {
      mockHttp([QUOTE]);
      const res: any = await findNewLeads.execute(newClient(), {
        filters: { employees_min: 10 },
        count: 3,
        qualify: value,
        request_id: "flags-case",
      } as any);
      expect(res.mode).toBe("needs_confirmation");
      expect(bodies()[0].qualify).toBe(true);
    }
  );

  it('qualify:"false" stays free and reaches the wire as a boolean', async () => {
    mockHttp([
      { method: "POST", path: "/1.6/mcp/search", status: 200, body: { job_id: "j1" } },
      {
        method: "GET",
        path: /^\/1\.6\/mcp\/jobs\//,
        status: 200,
        body: {
          job: { id: "j1", state: "completed" },
          funnel: { delivered: 0 },
          items: [],
          next_since: null,
          cost: { spent: 0, unit: "cost_cents", breakdown: {} },
          explain: {},
        },
      },
    ]);
    const res: any = await findNewLeads.execute(newClient(), {
      filters: { employees_min: 10 },
      count: 3,
      qualify: "false",
      wait_seconds: 0,
      request_id: "flags-2",
    } as any);
    expect(res.job_id).toBe("j1");
    expect(bodies()[0].qualify).toBe(false);
  });

  it.each([1, 0, "yes", "on", [], {}])(
    "qualify:%o is refused, not guessed",
    async (value) => {
      mockHttp([]);
      await expect(
        findNewLeads.execute(newClient(), {
          filters: { employees_min: 10 },
          count: 3,
          qualify: value,
          request_id: "flags-3",
        } as any)
      ).rejects.toMatchObject({ code: "BAD_INPUT" });
      expect(getHttpRequests()).toHaveLength(0);
    }
  );
});

describe("dry_run is a boolean, never a truthiness test", () => {
  it('dry_run:"false" takes the SUBMIT path with the gate in front of it', async () => {
    mockHttp([QUOTE]);
    const res: any = await findNewLeads.execute(newClient(), {
      filters: { employees_min: 10 },
      count: 3,
      qualify: true,
      dry_run: "false",
      request_id: "flags-4",
    } as any);

    // The old bug answered {dry_run: true} after a REAL submit. It must now be
    // the withheld-paid answer instead.
    expect(res.dry_run).toBeUndefined();
    expect(res.mode).toBe("needs_confirmation");
    expect(res.submitted).toBe(false);
    // And the body must not carry the string that made the backend submit.
    expect(bodies()[0].dry_run).toBe(true);
  });

  it('dry_run:"true" still quotes, and says so', async () => {
    mockHttp([QUOTE]);
    const res: any = await findNewLeads.execute(newClient(), {
      filters: { employees_min: 10 },
      count: 3,
      dry_run: "true",
      request_id: "flags-5",
    } as any);
    expect(res.dry_run).toBe(true);
    expect(bodies()[0].dry_run).toBe(true);
  });

  it('qualify_leads dry_run:"false" does not answer as a dry run', async () => {
    mockHttp([QUOTE]);
    const res: any = await qualifyLeads.execute(newClient(), {
      lead_refs: [{ lead_id: "a" }],
      dry_run: "false",
      request_id: "flags-6",
    } as any);
    expect(res.dry_run).toBeUndefined();
    expect(res.mode).toBe("needs_confirmation");
    expect(bodies()[0].dry_run).toBe(true);
  });
});

describe("confirm is a boolean too", () => {
  it('confirm:"true" consents — it no longer silently re-quotes', async () => {
    mockHttp([
      { method: "POST", path: "/1.6/mcp/qualify", status: 200, body: { job_id: "j9" } },
      {
        method: "GET",
        path: /^\/1\.6\/mcp\/jobs\//,
        status: 200,
        body: {
          job: { id: "j9", state: "completed" },
          funnel: { delivered: 0 },
          items: [],
          next_since: null,
          cost: { spent: 0, unit: "cost_cents", breakdown: {} },
          explain: {},
        },
      },
    ]);
    const res: any = await qualifyLeads.execute(newClient(), {
      lead_refs: [{ lead_id: "a" }],
      confirm: "true",
      wait_seconds: 0,
      request_id: "flags-7",
    } as any);
    expect(res.job_id).toBe("j9");
  });

  it('confirm:"false" vetoes with no round-trip', async () => {
    mockHttp([]);
    const res: any = await qualifyLeads.execute(newClient(), {
      lead_refs: [{ lead_id: "a" }],
      confirm: "false",
      request_id: "flags-8",
    } as any);
    expect(res.vetoed).toBe(true);
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("confirm:1 is refused rather than read as consent", async () => {
    mockHttp([]);
    await expect(
      qualifyLeads.execute(newClient(), {
        lead_refs: [{ lead_id: "a" }],
        confirm: 1,
        request_id: "flags-9",
      } as any)
    ).rejects.toMatchObject({ code: "BAD_INPUT" });
    expect(getHttpRequests()).toHaveLength(0);
  });
});
