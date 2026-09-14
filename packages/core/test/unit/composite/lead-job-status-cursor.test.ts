/**
 * Cursor propagation through the block-waiting path of leadbay_lead_job_status.
 *
 * `since` + `wait_seconds > 0` used to drop the cursor: waitForJob took no
 * since/limit, so the promised incremental poll silently became a full
 * limit=100 snapshot that re-emitted every already-seen lead. The tool's own
 * description promises both behaviours at once, so they must compose.
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
import { leadJobStatus } from "../../../src/composite/lead-job-status.js";
import { MCP_JOB_POLL } from "../../../src/composite/_mcp-job-helpers.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.tok", "us");

const JOB_ID = "3f0a91cc-77b2-4de6-9a10-1e5b7c2d8a44";
const CURSOR = "2026-07-28T10:20:00Z";

const TERMINAL_SNAPSHOT = {
  job: { job_id: JOB_ID, state: "completed" },
  funnel: { delivered: 1, examined: 1 },
  items: [
    {
      ref: { input_indexes: [0] },
      status: "delivered",
      seq: 7,
      lead: { lead_id: "aaaa1111-2222-3333-4444-555566667777" },
    },
  ],
  cost: { spent: 94, unit: "cost_cents" },
  next_since: "2026-07-28T10:25:00Z",
};

beforeEach(() => resetHttpMock());

const getPaths = () =>
  getHttpRequests()
    .filter((r: any) => r.method === "GET")
    .map((r: any) => r.path as string);

describe("leadbay_lead_job_status — cursor through the wait path", () => {
  it("forwards since + limit when block-waiting", async () => {
    // Terminal on the first read, so waitForJob returns after one snapshot.
    mockHttp([
      {
        method: "GET",
        path: `/1.6/mcp/jobs/${JOB_ID}?limit=25&since=${encodeURIComponent(CURSOR)}`,
        status: 200,
        body: TERMINAL_SNAPSHOT,
      },
    ]);

    const result: any = await leadJobStatus.execute(newClient(), {
      job_id: JOB_ID,
      since: CURSOR,
      limit: 25,
      wait_seconds: 30,
    });

    expect(result.done).toBe(true);

    const paths = getPaths();
    expect(paths).toHaveLength(1);
    expect(paths[0]).toContain(`since=${encodeURIComponent(CURSOR)}`);
    expect(paths[0]).toContain("limit=25");
  });

  it("still forwards since + limit on the non-waiting path", async () => {
    mockHttp([
      {
        method: "GET",
        path: `/1.6/mcp/jobs/${JOB_ID}?limit=25&since=${encodeURIComponent(CURSOR)}`,
        status: 200,
        body: TERMINAL_SNAPSHOT,
      },
    ]);

    await leadJobStatus.execute(newClient(), {
      job_id: JOB_ID,
      since: CURSOR,
      limit: 25,
      wait_seconds: 0,
    });

    const paths = getPaths();
    expect(paths[0]).toContain(`since=${encodeURIComponent(CURSOR)}`);
    expect(paths[0]).toContain("limit=25");
  });
});

describe("leadbay_lead_job_status — wait bound", () => {
  it("does not sleep a full interval past a short wait_seconds", async () => {
    // A running job never goes terminal, so only the deadline stops the loop.
    const RUNNING = {
      ...TERMINAL_SNAPSHOT,
      job: { job_id: JOB_ID, state: "running" },
    };
    mockHttp(
      Array.from({ length: 12 }, () => ({
        method: "GET" as const,
        path: `/1.6/mcp/jobs/${JOB_ID}?limit=100`,
        status: 200,
        body: RUNNING,
      }))
    );

    // Real 4s intervals would make this test unusable; shrink the cadence and
    // assert the loop respects a deadline SHORTER than one interval.
    const original = MCP_JOB_POLL.intervalMs;
    MCP_JOB_POLL.intervalMs = 400;
    try {
      const startedAt = Date.now();
      const result: any = await leadJobStatus.execute(newClient(), {
        job_id: JOB_ID,
        wait_seconds: 0.2,
      });
      const elapsed = Date.now() - startedAt;

      expect(result.still_running).toBe(true);
      // Bounded by the deadline (0.2s), not by the 400ms interval.
      expect(elapsed).toBeLessThan(400);
    } finally {
      MCP_JOB_POLL.intervalMs = original;
    }
  });
});
