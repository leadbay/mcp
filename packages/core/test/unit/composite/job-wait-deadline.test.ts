import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { LeadbayClient } from "../../../src/client.js";
import {
  waitForJob,
  collectJobSnapshot,
  SNAPSHOT_TIMEOUT_MS,
  MCP_JOB_POLL,
} from "../../../src/composite/_mcp-job-helpers.js";

type Opts = { signal?: AbortSignal; timeoutMs?: number; totalTimeoutMs?: number };

const snapshot = (state: string) => ({
  job: { state },
  items: [],
  funnel: {},
  cost: { spent: 0 },
  next_since: null,
});

// Records the opts of every request so the deadline can be asserted where it
// actually matters — on the wire call, not on the helper's signature.
function stubClient(
  handler: (call: number) => unknown
): { client: LeadbayClient; opts: Opts[] } {
  const opts: Opts[] = [];
  let call = 0;
  const client = {
    request: async (_m: string, _p: string, _b: unknown, o?: Opts) => {
      opts.push(o ?? {});
      const out = handler(call++);
      if (out instanceof Error) throw out;
      return out;
    },
  } as unknown as LeadbayClient;
  return { client, opts };
}

const timeoutErr = () => {
  const e = new Error("Request timed out after 1000ms: GET /x") as Error & { code?: string };
  e.code = "TIMEOUT";
  return e;
};

// Use the documented cadence seam so the multi-poll cases don't sleep for real.
const REAL_INTERVAL = MCP_JOB_POLL.intervalMs;
beforeEach(() => {
  MCP_JOB_POLL.intervalMs = 5;
});
afterEach(() => {
  MCP_JOB_POLL.intervalMs = REAL_INTERVAL;
});

describe("job snapshots are bounded by the caller's wait budget", () => {
  it("bounds the FIRST snapshot, not just the ones after the loop condition", async () => {
    const { client, opts } = stubClient(() => snapshot("completed"));
    await waitForJob(client, "job-1", 5);

    expect(opts).toHaveLength(1);
    // Before the fix this was undefined: wait_seconds was enforced only by the
    // loop condition, which is not evaluated until the first GET has returned.
    expect(opts[0].totalTimeoutMs).toBeDefined();
    expect(opts[0].totalTimeoutMs!).toBeLessThanOrEqual(5000);
  });

  it("never lets a snapshot outlive the requested wait", async () => {
    const { client, opts } = stubClient(() => snapshot("completed"));
    await waitForJob(client, "job-1", 1);
    expect(opts[0].totalTimeoutMs!).toBeLessThanOrEqual(1000);
  });

  it("caps a generous wait at the per-request ceiling", async () => {
    const { client, opts } = stubClient(() => snapshot("completed"));
    await waitForJob(client, "job-1", 600);
    expect(opts[0].totalTimeoutMs).toBe(SNAPSHOT_TIMEOUT_MS);
  });

  it("gives a zero-wait poll a bound of its own", async () => {
    const { client, opts } = stubClient(() => snapshot("running"));
    await collectJobSnapshot(client, "job-1");
    expect(opts[0].totalTimeoutMs).toBe(SNAPSHOT_TIMEOUT_MS);
  });

  it("keeps the job_id when the first read times out, rather than losing a paid job", async () => {
    const { client } = stubClient(() => timeoutErr());
    await expect(waitForJob(client, "job-abc", 2)).rejects.toMatchObject({
      code: "JOB_READ_TIMEOUT",
    });
    // The handle must be recoverable from the error itself.
    await waitForJob(client, "job-abc", 2).catch((e) => {
      expect(e.message).toContain("job-abc");
      expect(e.hint).toContain("job-abc");
      expect(e.hint).toContain("leadbay_lead_job_status");
    });
  });

  it("returns the last good snapshot when a LATER read times out", async () => {
    // First read succeeds (running), the follow-up poll times out.
    const { client } = stubClient((n) => (n === 0 ? snapshot("running") : timeoutErr()));
    const snap = await waitForJob(client, "job-1", 5);
    // A live job must not be discarded over one slow read.
    expect(snap.job.state).toBe("running");
  });

  it("propagates a non-timeout failure untouched", async () => {
    const { client } = stubClient(() => new Error("boom"));
    await expect(waitForJob(client, "job-1", 2)).rejects.toThrow("boom");
  });
});

describe("the wait bounds the whole drain, not each page of it", () => {
  const page = (n: number, full: boolean) => ({
    job: { state: "completed" },
    items: full ? Array.from({ length: 2 }, (_, i) => ({ id: `${n}-${i}` })) : [],
    funnel: {},
    cost: { spent: 0 },
    next_since: full ? `cur-${n}` : null,
  });

  it("spends one budget across the pages instead of handing each page a fresh one", async () => {
    // Every page comes back FULL with a cursor, so the drain would run until
    // maxPages. Per-request timeouts let each of those pages claim the caller's
    // whole wait_seconds — the budget multiplied by the page count.
    //
    // The clock MUST advance for this to mean anything: with a frozen clock
    // `remaining()` and a per-page `timeoutMs` are indistinguishable, and the
    // test passes against the very bug it is meant to catch.
    let now = 0;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      const { client, opts } = stubClient((n) => {
        now += 100;
        return page(n, true);
      });
      await waitForJob(client, "job-1", 5, undefined, undefined, undefined, 2);

      expect(opts.length).toBeGreaterThan(1);
      const budgets = opts.map((o) => o.totalTimeoutMs!);
      // STRICTLY decreasing: each page is bounded by what is LEFT, so the drain
      // as a whole cannot outlast the wait. A per-page budget would hold flat.
      for (let i = 1; i < budgets.length; i++) {
        expect(budgets[i]).toBeLessThan(budgets[i - 1]);
      }
      expect(Math.max(...budgets)).toBeLessThanOrEqual(5000);
      // And the total handed out must not exceed the wait, which is precisely
      // what "one budget per page" violated.
      expect(budgets[budgets.length - 1]).toBeLessThanOrEqual(5000 - 100 * (budgets.length - 1));
    } finally {
      spy.mockRestore();
    }
  });

  it("stops paging once the budget is spent rather than starting a doomed page", async () => {
    let now = 0;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      // Each page consumes 400ms of a 1s budget.
      const { client, opts } = stubClient((n) => {
        now += 400;
        return page(n, true);
      });
      const snap = await waitForJob(client, "job-1", 1, undefined, undefined, undefined, 2);
      // 1000ms / 400ms — the drain must stop, not run to maxPages.
      expect(opts.length).toBeLessThanOrEqual(3);
      // And it must SAY it stopped early: a full last page plus a cursor is a
      // prefix, not a finished read.
      expect(snap.items_truncated).toBe(true);
      expect(snap.next_since).toBeTruthy();
    } finally {
      spy.mockRestore();
    }
  });

  it("does not flag a drain that finished naturally", async () => {
    // Short page = the cursor ran dry.
    const { client } = stubClient(() => page(0, false));
    const snap = await waitForJob(client, "job-1", 5, undefined, undefined, undefined, 2);
    expect(snap.items_truncated).toBeUndefined();
  });
});
