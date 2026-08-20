import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { LeadbayClient } from "../../../src/client.js";
import {
  waitForJob,
  collectJobSnapshot,
  SNAPSHOT_TIMEOUT_MS,
  MCP_JOB_POLL,
} from "../../../src/composite/_mcp-job-helpers.js";

type Opts = { signal?: AbortSignal; timeoutMs?: number };

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
    expect(opts[0].timeoutMs).toBeDefined();
    expect(opts[0].timeoutMs!).toBeLessThanOrEqual(5000);
  });

  it("never lets a snapshot outlive the requested wait", async () => {
    const { client, opts } = stubClient(() => snapshot("completed"));
    await waitForJob(client, "job-1", 1);
    expect(opts[0].timeoutMs!).toBeLessThanOrEqual(1000);
  });

  it("caps a generous wait at the per-request ceiling", async () => {
    const { client, opts } = stubClient(() => snapshot("completed"));
    await waitForJob(client, "job-1", 600);
    expect(opts[0].timeoutMs).toBe(SNAPSHOT_TIMEOUT_MS);
  });

  it("gives a zero-wait poll a bound of its own", async () => {
    const { client, opts } = stubClient(() => snapshot("running"));
    await collectJobSnapshot(client, "job-1");
    expect(opts[0].timeoutMs).toBe(SNAPSHOT_TIMEOUT_MS);
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
