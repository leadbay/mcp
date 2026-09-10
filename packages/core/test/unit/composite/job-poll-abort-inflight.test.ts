/**
 * Cancellation must reach the in-flight request, not just the sleep between
 * polls.
 *
 * Making the delay abortable was only half of it: `waitForJob` still checked
 * `ctx.signal` only AFTER awaiting `collectJobSnapshot`, and the snapshot's GET
 * took no signal at all. A cancel arriving before or during a slow `/mcp/jobs`
 * response therefore sat blocked until the server answered — well past the
 * "polling loop exits within <=2 seconds" the server advertises in its own
 * instructions.
 *
 * Three properties pinned here: an already-cancelled wait opens no request at
 * all, the signal reaches the HTTP layer, and a cancel mid-drain stops paging.
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
import {
  waitForJob,
  collectJobSnapshot,
} from "../../../src/composite/_mcp-job-helpers.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.tok", "us");

beforeEach(() => resetHttpMock());

const runningPage = (n: number) => ({
  method: "GET" as const,
  path: /^\/1\.6\/mcp\/jobs\//,
  status: 200,
  body: {
    job: { id: "job-1", state: "running" },
    funnel: { delivered: n, examined: n },
    items: [{ status: "delivered", seq: n }],
    next_since: `cur-${n}`,
    cost: { spent: 0, unit: "cost_cents", breakdown: {} },
    explain: { region: "us", model: "m" },
  },
});

describe("waitForJob — cancellation reaches the request", () => {
  it("opens NO request when the signal is already aborted", async () => {
    mockHttp([runningPage(1)]);
    const ac = new AbortController();
    ac.abort();
    await expect(
      waitForJob(newClient(), "job-1", 60, { signal: ac.signal } as any)
    ).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
    // The point: not one byte went out for a wait nobody is listening to.
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("says the job keeps running, since cancelling the wait does not stop it", async () => {
    mockHttp([runningPage(1)]);
    const ac = new AbortController();
    ac.abort();
    const err = await waitForJob(
      newClient(),
      "job-1",
      60,
      { signal: ac.signal } as any
    ).catch((e) => e);
    expect(err.hint).toMatch(/backend-owned|keeps running/i);
    expect(err.hint).toMatch(/leadbay_lead_job_status/);
  });
});

describe("collectJobSnapshot — abort stops the drain", () => {
  it("stops paging once the signal aborts", async () => {
    // Full pages keep the drain going; aborting after the first must end it
    // rather than walking every page the bound allows.
    mockHttp([runningPage(1), runningPage(2), runningPage(3)]);
    const ac = new AbortController();
    const client = newClient();
    const p = collectJobSnapshot(client, "job-1", undefined, 1, ac.signal);
    ac.abort();
    const snap = await p.catch(() => null);
    // Either it rejected (abort hit the socket) or it stopped early — what it
    // must NOT do is drain all three pages as if nothing happened.
    const gets = getHttpRequests().filter((r) => r.method === "GET");
    expect(gets.length).toBeLessThan(3);
    if (snap) expect(snap.items.length).toBeLessThan(3);
  });

  it("still drains normally with no signal", async () => {
    // Last page carries no cursor, which is what ends a normal drain.
    const lastPage = {
      ...runningPage(2),
      body: { ...runningPage(2).body, next_since: null },
    };
    mockHttp([runningPage(1), lastPage]);
    const snap = await collectJobSnapshot(newClient(), "job-1", undefined, 1);
    expect(snap.items.length).toBe(2);
  });
});
