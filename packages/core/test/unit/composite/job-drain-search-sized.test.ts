/**
 * The page drain must be sized for the LARGEST job, not just qualify.
 *
 * `maxPagesFor` derives its bound from MAX_JOB_ITEMS. That constant was 500 —
 * a qualify job's ref ceiling — but a SEARCH may examine up to
 * `exploration_cap`'s ceiling of min(20n, 1000) candidates and emit an outcome
 * for each. With a small `limit` on `leadbay_lead_job_status`, the drain then
 * stopped mid-job and still returned a terminal snapshot with no cursor, so
 * paid deliveries — and the rejected ids the top-up needs for
 * `exclude_lead_ids` — silently never reached the render.
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
import { collectJobSnapshot } from "../../../src/composite/_mcp-job-helpers.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.tok", "us");

beforeEach(() => resetHttpMock());

/** A job that emits `total` outcomes, one item per page (limit=1) — the worst
 *  case for the page bound, and the one Codex named. */
function mockPagedJob(total: number) {
  const pages = Array.from({ length: total }, (_, i) => ({
    method: "GET" as const,
    path: /^\/1\.6\/mcp\/jobs\//,
    status: 200,
    body: {
      job: { id: "job-1", state: "completed" },
      funnel: { delivered: total, examined: total },
      items: [{ status: "delivered", seq: i + 1 }],
      next_since: i + 1 < total ? `cur-${i + 1}` : null,
      cost: { spent: 0, unit: "cost_cents", breakdown: {} },
      explain: { region: "us", model: "m" },
    },
  }));
  mockHttp(pages);
}

describe("collectJobSnapshot — drain sized for a wide search", () => {
  it("drains a 1000-outcome search at limit=1 without truncating", async () => {
    // count:50 -> exploration_cap ceiling min(20n, 1000). The old bound of 500
    // stopped here at 501 pages and reported the job done.
    mockPagedJob(1000);
    const snap = await collectJobSnapshot(newClient(), "job-1", undefined, 1);
    expect(snap.items).toHaveLength(1000);
  });

  it("still drains the qualify ceiling of 500", async () => {
    mockPagedJob(500);
    const snap = await collectJobSnapshot(newClient(), "job-1", undefined, 1);
    expect(snap.items).toHaveLength(500);
  });

  it("stops as soon as a short page says the cursor is caught up", async () => {
    // The bound is a backstop, not the drain signal — a short page must still
    // end it immediately rather than burning the full page budget.
    mockPagedJob(3);
    const snap = await collectJobSnapshot(newClient(), "job-1", undefined, 1);
    expect(snap.items).toHaveLength(3);
    expect(getHttpRequests().filter((r) => r.method === "GET")).toHaveLength(3);
  });
});
