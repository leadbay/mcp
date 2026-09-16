/**
 * product#4144 — a qualify_leads call must come back before the host times it
 * out, and the follow-up it suggests must not sit on that boundary.
 *
 * The MCP SDK gives a tool call 60s (DEFAULT_REQUEST_TIMEOUT_MSEC) and then
 * cancels it. The user sees an error, and the job they paid for keeps running.
 *
 * FR prod, 2026-09-16, org LEADBAY, lens 5885: one uncached lead. The submit
 * POST alone took ~20s, the wait ran on top of it, and the call returned
 * 62,120ms after it started.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { LeadbayClient } from "../../../src/client.js";
import { qualifyLeads } from "../../../src/composite/qualify-leads.js";
import { MCP_JOB_POLL } from "../../../src/composite/_mcp-job-helpers.js";

// What the host allows one tool call, before it cancels and the user sees an
// error over a job that is still spending.
const HOST_TIMEOUT_MS = 60_000;
// Measured on the run in the issue: submit → job_id.
const SUBMIT_MS = 20_000;
const JOB_ID = "95107114-6a0e-4a3f-9a2c-5ad2f6f1c0b1";

/** A client on a fake clock: every request costs measurable time, so the wall
 *  clock of the whole tool call can be asserted without sleeping for it. */
function clockedClient(): { client: LeadbayClient; elapsedMs: () => number } {
  const start = 1_760_000_000_000;
  let now = start;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const client = {
    region: "fr",
    request: async (method: string) => {
      if (method === "POST") {
        now += SUBMIT_MS;
        return {
          job_id: JOB_ID,
          items_requested: 1,
          estimated_cost: { max: 94 },
        };
      }
      // A status read on a job that has not finished yet.
      now += 500;
      return {
        job: { state: "running" },
        items: [],
        funnel: { delivered: 0 },
        cost: { spent: 0 },
        next_since: null,
      };
    },
  } as unknown as LeadbayClient;
  return { client, elapsedMs: () => now - start };
}

const REAL_INTERVAL = MCP_JOB_POLL.intervalMs;
beforeEach(() => {
  MCP_JOB_POLL.intervalMs = 1;
});
afterEach(() => {
  MCP_JOB_POLL.intervalMs = REAL_INTERVAL;
  vi.restoreAllMocks();
});

const oneLead = {
  lead_refs: [{ website: "acme.example" }],
  qualify: true,
  confirm: true,
};

describe("a job wait never blocks to the host's 60s ceiling (product#4144)", () => {
  it("returns before the ceiling even when the submit itself took 20s", async () => {
    const { client, elapsedMs } = clockedClient();
    const res = (await qualifyLeads.execute(client, { ...oneLead })) as any;

    expect(res.still_running).toBe(true);
    expect(res.job_id).toBe(JOB_ID);
    expect(elapsedMs()).toBeLessThan(HOST_TIMEOUT_MS);
  });

  it("caps a caller who asks for three times the ceiling", async () => {
    const { client, elapsedMs } = clockedClient();
    await qualifyLeads.execute(client, { ...oneLead, wait_seconds: 180 });
    expect(elapsedMs()).toBeLessThan(HOST_TIMEOUT_MS);
  });

  it("hands back a follow-up wait that is under the ceiling, not on it", async () => {
    const { client } = clockedClient();
    const res = (await qualifyLeads.execute(client, { ...oneLead })) as any;

    expect(res.next_poll.tool).toBe("leadbay_lead_job_status");
    expect(res.next_poll.suggested_wait_seconds * 1000).toBeLessThan(
      HOST_TIMEOUT_MS
    );
  });
});
