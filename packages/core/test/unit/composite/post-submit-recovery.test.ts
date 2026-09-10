/**
 * Two ways a paid job could be stranded, and the exhausted-budget overrun.
 *
 * 1. Once the submit returns, a backend-owned job EXISTS and may be spending.
 *    Any later failure must still hand back job_id — it is the only route to
 *    what the user just bought. Previously only a TIMEOUT on the block-waiting
 *    branch preserved it; an abort, a reset or a 5xx propagated bare, and the
 *    zero-wait branch preserved nothing at all.
 * 2. Truncation means rows were paid for but not read. The rendering rule tells
 *    the agent to fetch them with `since: next_since` — which the response has
 *    to actually contain, including on a job that has already finished.
 */
import { describe, it, expect, vi } from "vitest";
import type { LeadbayClient } from "../../../src/client.js";
import {
  waitForJob,
  collectJobSnapshot,
  snapshotAfterSubmit,
  MCP_JOB_POLL,
} from "../../../src/composite/_mcp-job-helpers.js";

const snap = (state: string, extra: Record<string, unknown> = {}) => ({
  job: { state },
  items: [],
  funnel: {},
  cost: { spent: 0 },
  next_since: null,
  ...extra,
});

const clientThatThrows = (e: unknown) =>
  ({ request: async () => { throw e; } }) as unknown as LeadbayClient;

const coded = (code: string, message: string) => {
  const e = new Error(message) as Error & { code?: string };
  e.code = code;
  return e;
};

describe("post-submit failures keep the job handle", () => {
  it.each([
    ["a connection reset", coded("ECONNRESET", "socket hang up")],
    ["a backend 5xx", { error: true, code: "UPSTREAM_ERROR", message: "502" }],
    ["a cancellation", { error: true, code: "REQUEST_CANCELLED", message: "gone" }],
    ["a bare error", new Error("something else")],
  ])("attaches job_id when the wait branch hits %s", async (_label, err) => {
    const e = await snapshotAfterSubmit(clientThatThrows(err), "job-42", 5).catch((x) => x);
    expect(e.job_id).toBe("job-42");
    expect(e.hint).toContain("leadbay_lead_job_status");
  });

  it("attaches job_id on the ZERO-WAIT branch too", async () => {
    // This branch previously propagated every failure bare.
    const e = await snapshotAfterSubmit(
      clientThatThrows(coded("ECONNRESET", "socket hang up")),
      "job-42",
      0
    ).catch((x) => x);
    expect(e.job_id).toBe("job-42");
  });

  it("does not double-wrap an error that already carries the handle", async () => {
    const e = await snapshotAfterSubmit(
      clientThatThrows(coded("TIMEOUT", "slow")),
      "job-42",
      1
    ).catch((x) => x);
    expect(e.code).toBe("JOB_READ_TIMEOUT");
    expect(e.job_id).toBe("job-42");
    expect(e.message).not.toContain("reading its status failed");
  });

  it("passes a successful snapshot straight through", async () => {
    const client = { request: async () => snap("completed") } as unknown as LeadbayClient;
    await expect(snapshotAfterSubmit(client, "job-42", 0)).resolves.toMatchObject({
      job: { state: "completed" },
    });
  });
});

describe("an exhausted wait budget stops the poll", () => {
  const REAL = MCP_JOB_POLL.intervalMs;

  it("does not grant a final snapshot a budget the caller no longer has", async () => {
    MCP_JOB_POLL.intervalMs = 5;
    let now = 0;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => now);
    const opts: Array<{ totalTimeoutMs?: number }> = [];
    try {
      const client = {
        request: async (_m: string, _p: string, _b: unknown, o?: { totalTimeoutMs?: number }) => {
          opts.push(o ?? {});
          now += 400; // every read eats most of a 1s budget
          return snap("running");
        },
      } as unknown as LeadbayClient;

      await waitForJob(client, "job-1", 1);
      // The old 1s FLOOR let a final poll run a full second past an already
      // spent budget, so `wait_seconds: 1` took ~2s. Asserting "<= 1000" cannot
      // catch that — the floor IS 1000. Each budget must match what is actually
      // left, so they strictly decrease.
      expect(opts.length).toBeGreaterThan(1);
      const budgets = opts.map((o) => o.totalTimeoutMs!);
      for (let i = 1; i < budgets.length; i++) {
        expect(budgets[i]).toBeLessThan(budgets[i - 1]);
      }
      // 400ms consumed per read out of 1000 → the last one gets ~200, not 1000.
      expect(budgets[budgets.length - 1]).toBeLessThanOrEqual(200);
    } finally {
      spy.mockRestore();
      MCP_JOB_POLL.intervalMs = REAL;
    }
  });

  it("does not round a fractional wait up on the first snapshot", async () => {
    const opts: Array<{ totalTimeoutMs?: number }> = [];
    const client = {
      request: async (_m: string, _p: string, _b: unknown, o?: { totalTimeoutMs?: number }) => {
        opts.push(o ?? {});
        return snap("completed");
      },
    } as unknown as LeadbayClient;

    await waitForJob(client, "job-1", 0.5);
    // A 1s floor turned a 500ms wait into a 1s one.
    expect(opts[0].totalTimeoutMs!).toBeLessThanOrEqual(500);
  });
});

describe("a truncated drain hands back a usable cursor", () => {
  it("keeps next_since on the snapshot when the drain stops early", async () => {
    let call = 0;
    const client = {
      request: async () => {
        call++;
        // Full page + cursor = more to come.
        return {
          ...snap("completed"),
          items: [{ id: "a" }, { id: "b" }],
          next_since: `cur-${call}`,
        };
      },
    } as unknown as LeadbayClient;

    const s = await collectJobSnapshot(client, "job-1", undefined, 2, undefined, 1);
    expect(s.items_truncated).toBe(true);
    // The rendering rule names this cursor; it has to exist.
    expect(s.next_since).toBeTruthy();
  });
});
