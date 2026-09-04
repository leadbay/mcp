/**
 * A finished job can still owe rows.
 *
 * When the page drain runs out of budget AFTER the backend job has gone
 * terminal, `done` is true — so `next_poll` was null — while `items_truncated`
 * is also true. The rendering rule tells the agent to fetch the rest with
 * `leadbay_lead_job_status(job_id, since: next_since)`, but neither the cursor
 * nor a continuation action was present anywhere in the response. The rows were
 * paid for and simply unreachable.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { findNewLeads } from "../../../src/composite/find-new-leads.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.tok", "us");

beforeEach(() => resetHttpMock());

// A page that is FULL and still carries a cursor — the drain's "more to come"
// signal — on a job the backend already marked completed.
const fullPage = (cursor: string) => ({
  job: { state: "completed" },
  items: Array.from({ length: 100 }, (_, i) => ({
    id: `${cursor}-${i}`,
    status: "delivered",
    company: { name: "Acme" },
  })),
  funnel: { delivered: 250 },
  cost: { spent: 0 },
  next_since: cursor,
});

describe("truncated + terminal — the rest stays reachable", () => {
  it("returns the cursor and a continuation even though done is true", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.6/mcp/search",
        status: 200,
        body: { job_id: "job-t", state: "queued", items_requested: 250 },
      },
      // Every page is full + cursored, so the drain stops on its own budget.
      ...Array.from({ length: 30 }, (_, i) => ({
        method: "GET" as const,
        path: new RegExp("^/1\\.6/mcp/jobs/job-t"),
        status: 200,
        body: fullPage(`cur-${i}`),
      })),
    ]);

    const res: any = await findNewLeads.execute(
      newClient(),
      {
        example_lead: { description: "independent gym" },
        count: 50,
        request_id: "trunc-test",
        wait_seconds: 0,
      } as any,
      {} as any
    );

    expect(res.done).toBe(true);
    expect(res.items_truncated).toBe(true);
    // The two things the rendering rule needs, both previously absent here.
    expect(res.next_since).toBeTruthy();
    expect(res.next_poll).not.toBeNull();
    expect(res.next_poll.tool).toBe("leadbay_lead_job_status");
    expect(res.next_poll.job_id).toBe("job-t");
    expect(res.next_poll.since).toBe(res.next_since);
    // It is a page fetch, not a wait — nothing is still running.
    expect(res.next_poll.suggested_wait_seconds).toBe(0);
  });

  it("still returns no continuation for a clean, complete job", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.6/mcp/search",
        status: 200,
        body: { job_id: "job-c", state: "queued", items_requested: 5 },
      },
      {
        method: "GET",
        path: new RegExp("^/1\\.6/mcp/jobs/job-c"),
        status: 200,
        body: {
          job: { state: "completed" },
          items: [],
          funnel: { delivered: 0 },
          cost: { spent: 0 },
          next_since: null,
        },
      },
    ]);

    const res: any = await findNewLeads.execute(
      newClient(),
      {
        example_lead: { description: "independent gym" },
        count: 5,
        request_id: "clean-test",
        wait_seconds: 0,
      } as any,
      {} as any
    );

    expect(res.done).toBe(true);
    expect(res.items_truncated).toBe(false);
    expect(res.next_poll).toBeNull();
  });
});
