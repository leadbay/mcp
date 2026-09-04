/**
 * Unit tests for leadbay_lead_job_status (GET /mcp/jobs/{id} snapshot).
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

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.tok", "us");

const JOB_ID = "d89b9803-f9d8-4298-86af-9cd4b1841afd";

function item(seq: number, status = "delivered") {
  return {
    ref: { lead_id: `00000000-0000-0000-0000-00000000000${seq}` },
    status,
    seq,
    completed_at: "2026-07-28T10:30:00Z",
    cost: { billed: 0, unit: "cost_cents" },
    lead:
      status === "skipped"
        ? undefined
        : { lead_id: `00000000-0000-0000-0000-00000000000${seq}`, company: { name: `Co ${seq}` } },
  };
}

function page(state: string, items: unknown[], nextSince: string | null) {
  return {
    job: {
      id: JOB_ID,
      state,
      submitted_at: "2026-07-28T10:29:00Z",
      expires_at: "2026-08-27T10:29:00Z",
      last_progress_at: "2026-07-28T10:30:00Z",
    },
    funnel: { delivered: 3, examined: 4 },
    items,
    next_since: nextSince,
    cost: { spent: 0, unit: "cost_cents", breakdown: {} },
    explain: { region: "US", model: "text_v2_ai_description", scope_notes: [] },
  };
}

beforeEach(() => resetHttpMock());

describe("leadbay_lead_job_status", () => {
  it("terminal snapshot — splits leads/skipped, no next_poll", async () => {
    mockHttp([
      {
        method: "GET",
        path: `/1.6/mcp/jobs/${JOB_ID}?limit=100`,
        status: 200,
        body: page("completed", [item(0), item(1, "skipped")], "100:1"),
      },
    ]);
    const result = await leadJobStatus.execute(newClient(), { job_id: JOB_ID });
    expect(result.done).toBe(true);
    expect(result.leads).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.next_poll).toBeNull();
    expect(result.next_since).toBe("100:1");
  });

  it("pages the cursor dry when a page comes back full", async () => {
    mockHttp([
      {
        method: "GET",
        path: `/1.6/mcp/jobs/${JOB_ID}?limit=2`,
        status: 200,
        body: page("completed", [item(0), item(1)], "100:1"),
      },
      {
        method: "GET",
        path: `/1.6/mcp/jobs/${JOB_ID}?limit=2&since=${encodeURIComponent("100:1")}`,
        status: 200,
        body: page("completed", [item(2)], "101:2"),
      },
    ]);
    const result = await leadJobStatus.execute(newClient(), {
      job_id: JOB_ID,
      limit: 2,
    });
    expect(result.leads).toHaveLength(3);
    expect(getHttpRequests()).toHaveLength(2);
  });

  it("running job — still_running with next_poll handle", async () => {
    mockHttp([
      {
        method: "GET",
        path: `/1.6/mcp/jobs/${JOB_ID}?limit=100`,
        status: 200,
        body: page("running", [item(0)], "100:0"),
      },
    ]);
    const result = await leadJobStatus.execute(newClient(), { job_id: JOB_ID });
    expect(result.still_running).toBe(true);
    expect(result.next_poll).toMatchObject({ tool: "leadbay_lead_job_status", job_id: JOB_ID });
  });

  it("unknown job — 404 propagates", async () => {
    mockHttp([
      {
        method: "GET",
        path: `/1.6/mcp/jobs/${JOB_ID}?limit=100`,
        status: 404,
        body: { error: "not_found", message: "job" },
      },
    ]);
    await expect(
      leadJobStatus.execute(newClient(), { job_id: JOB_ID })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
