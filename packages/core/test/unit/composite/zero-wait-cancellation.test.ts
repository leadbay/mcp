/**
 * Cancellation reaches the ZERO-WAIT snapshot paths too.
 *
 * Threading the signal through `waitForJob` covered `wait_seconds > 0` and
 * left the three direct `collectJobSnapshot` calls — the default
 * `wait_seconds: 0` branch of lead_job_status, find_new_leads and
 * qualify_leads — passing no signal at all. A cancelled status poll therefore
 * still opened a GET and sat on it, which is the same defect the previous fix
 * was supposed to close.
 *
 * The guard now lives INSIDE collectJobSnapshot, so every call site inherits
 * it rather than each needing to remember.
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
import { leadJobStatus } from "../../../src/composite/lead-job-status.js";
import { findNewLeads } from "../../../src/composite/find-new-leads.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.tok", "us");

beforeEach(() => resetHttpMock());

const aborted = () => {
  const ac = new AbortController();
  ac.abort();
  return ac.signal;
};

describe("collectJobSnapshot — the guard every caller inherits", () => {
  it("throws REQUEST_CANCELLED and opens no request", async () => {
    mockHttp([]);
    await expect(
      collectJobSnapshot(newClient(), "job-1", undefined, undefined, aborted())
    ).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
    expect(getHttpRequests()).toHaveLength(0);
  });
});

describe("leadbay_lead_job_status — wait_seconds: 0", () => {
  it("a cancelled poll never reaches the network", async () => {
    mockHttp([]);
    await expect(
      leadJobStatus.execute(
        newClient(),
        { job_id: "job-1", wait_seconds: 0 } as any,
        { signal: aborted() } as any
      )
    ).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
    expect(getHttpRequests()).toHaveLength(0);
  });
});

describe("leadbay_find_new_leads — wait_seconds: 0", () => {
  it("the submit still lands, then the snapshot is cancelled", async () => {
    // The paid submit is deliberately NOT abortable — it may already have
    // committed server-side. What must not happen is polling it afterwards
    // on a call nobody is listening to.
    mockHttp([
      {
        method: "POST",
        path: "/1.6/mcp/search",
        status: 200,
        body: { job_id: "job-1", state: "queued", items: [] },
      },
    ]);
    await expect(
      findNewLeads.execute(
        newClient(),
        {
          example_lead: { description: "independent gym" },
          count: 5,
          request_id: "cancel-test",
          wait_seconds: 0,
        } as any,
        { signal: aborted() } as any
      )
    ).rejects.toMatchObject({ code: "REQUEST_CANCELLED" });
    const reqs = getHttpRequests();
    expect(reqs.filter((r) => r.method === "POST")).toHaveLength(1);
    expect(reqs.filter((r) => r.method === "GET")).toHaveLength(0);
  });
});
