/**
 * A later poll tick must never hand back LESS than an earlier one already had.
 *
 * `waitForJob` re-drains from the SAME `since` on every tick, under a budget
 * that shrinks as the wait runs down (`snapshotBudget(remainingMsOf())`). So a
 * later tick can truncate earlier than an earlier tick did and return fewer
 * items with a staler cursor. Overwriting `snap` blindly handed the caller a
 * regressed snapshot — rows a previous poll had already established simply
 * disappeared, and the resumption cursor moved backwards.
 *
 * The fresh job/funnel/cost projection is still the best available and is
 * always adopted; only the paid rows and the cursor are held at high water.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import {
  waitForJob,
  MCP_JOB_POLL,
} from "../../../src/composite/_mcp-job-helpers.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.tok", "us");
const JOBS = /^\/1\.6\/mcp\/jobs\//;

const page = (opts: {
  state: string;
  items: number[];
  next: string | null;
  spent: number;
}) => ({
  method: "GET" as const,
  path: JOBS,
  status: 200,
  body: {
    job: { id: "job-1", state: opts.state },
    funnel: { delivered: opts.items.length, examined: opts.items.length },
    items: opts.items.map((seq) => ({ status: "delivered", seq })),
    next_since: opts.next,
    cost: { spent: opts.spent, unit: "cost_cents", breakdown: {} },
    explain: { region: "us", model: "m" },
  },
});

let originalInterval: number;
beforeEach(() => {
  resetHttpMock();
  originalInterval = MCP_JOB_POLL.intervalMs;
  MCP_JOB_POLL.intervalMs = 20;
});
afterEach(() => {
  MCP_JOB_POLL.intervalMs = originalInterval;
});

describe("waitForJob — the snapshot only moves forward", () => {
  it("keeps the larger item set when a later tick truncates earlier", async () => {
    mockHttp([
      // Tick 1 drains four rows and parks the cursor at cur-2.
      page({ state: "running", items: [1, 2, 3, 4], next: "cur-2", spent: 100 }),
      // Tick 2 truncates: one row and an earlier cursor. This is the shape a
      // shrunken snapshot budget produces on a large, still-draining job.
      page({ state: "completed", items: [9], next: "cur-0", spent: 188 }),
    ]);

    const snap = await waitForJob(newClient(), "job-1", 5, undefined, 4);

    // The four rows from tick 1 survive; the single row from tick 2 does not
    // replace them.
    expect(snap.items.map((i: any) => i.seq)).toEqual([1, 2, 3, 4]);
    // The cursor does not travel backwards.
    expect(snap.next_since).toBe("cur-2");
    // But the newest projection IS adopted — that is the point of polling.
    expect(snap.job.state).toBe("completed");
    expect(snap.cost.spent).toBe(188);
  });

  it("adopts a later tick that carries at least as much", async () => {
    mockHttp([
      page({ state: "running", items: [1], next: null, spent: 50 }),
      page({ state: "completed", items: [1, 2, 3], next: "cur-3", spent: 90 }),
    ]);

    const snap = await waitForJob(newClient(), "job-1", 5, undefined, 3);

    expect(snap.items.map((i: any) => i.seq)).toEqual([1, 2, 3]);
    expect(snap.next_since).toBe("cur-3");
    expect(snap.job.state).toBe("completed");
    expect(snap.cost.spent).toBe(90);
  });
});
