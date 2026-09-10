/**
 * A paid submit is cancellable up to the moment of dispatch — and not after.
 *
 * The two halves are a single rule: cancellation is honoured exactly as long as
 * we can still PROVE nothing was spent. Queued behind the client's concurrency
 * slots, that proof holds. On the wire it does not: the backend may already
 * have committed the job, charged for it and claimed novelty on the leads, and
 * a torn-down socket cannot tell us which.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventEmitter } from "node:events";

const sent: string[] = [];
// Every dispatched request parks here until the test releases it. Nothing
// completes on its own — a double that auto-answers can never produce the
// "all slots busy, this one is queued" state these tests are about.
const pending: Array<() => void> = [];

vi.mock("node:https", () => ({
  default: {
    request: (options: Record<string, unknown>, cb?: (res: unknown) => void) => {
      const req = new EventEmitter() as EventEmitter & {
        write: () => void;
        end: () => void;
        destroy: () => void;
      };
      req.write = () => {};
      req.destroy = () => {};
      req.end = () => {
        // Record at DISPATCH: this array is the record of what actually left
        // the process, which is the only thing that can cost money.
        sent.push(`${options.method} ${options.path}`);
        const finish = () => {
          const res = new EventEmitter() as EventEmitter & {
            statusCode: number;
            headers: Record<string, string>;
          };
          res.statusCode = 200;
          res.headers = {};
          cb?.(res);
          res.emit("data", Buffer.from(JSON.stringify({ job_id: "job-1", state: "queued" })));
          res.emit("end");
        };
        pending.push(finish);
      };
      return req;
    },
  },
}));

import { LeadbayClient } from "../../../src/client.js";

const newClient = () => new LeadbayClient("https://api-us.leadbay.app", "u.tok", "us");
const settled = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  sent.length = 0;
  pending.length = 0;
});

const flush = () => {
  const queued = pending.splice(0);
  queued.forEach((f) => f());
};

describe("preSendSignal — the pre-dispatch cancellation window", () => {
  it("does not send a submit whose signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(
      newClient().request("POST", "/mcp/search", { q: 1 }, { preSendSignal: ac.signal })
    ).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
    expect(sent).toHaveLength(0);
  });

  it("cancels a submit still QUEUED behind busy slots, spending nothing", async () => {
    const client = newClient();
    // Occupy all five slots with requests that never answer.
    const stalled = Array.from({ length: 5 }, () =>
      client.request("GET", "/stalled").catch(() => {})
    );
    await settled();
    sent.length = 0;

    const ac = new AbortController();
    const submit = client.request("POST", "/mcp/search", { q: 1 }, {
      preSendSignal: ac.signal,
    });
    await settled();
    ac.abort();

    await expect(submit).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
    // The whole point: the POST never left the process, so it cannot have
    // charged, and it did not have to wait for the stalled traffic either.
    expect(sent.filter((s) => s.includes("/mcp/search"))).toHaveLength(0);
    void stalled;
  });

  it("lets an IN-FLIGHT submit finish rather than leaving the spend ambiguous", async () => {
    const client = newClient();
    const ac = new AbortController();
    const submit = client.request<{ job_id: string }>(
      "POST",
      "/mcp/search",
      { q: 1 },
      { preSendSignal: ac.signal }
    );
    await settled();
    // Dispatched — past the provable-no-spend boundary.
    expect(sent.filter((s) => s.includes("/mcp/search"))).toHaveLength(1);

    ac.abort();
    flush();

    // It resolves normally: the job_id survives, so a job that may have been
    // paid for is never orphaned by a late cancel.
    await expect(submit).resolves.toMatchObject({ job_id: "job-1" });
  });

  it("keeps full `signal` cancellation available for reads", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(
      newClient().request("GET", "/mcp/jobs/x", undefined, { signal: ac.signal })
    ).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
    expect(sent).toHaveLength(0);
  });
});
