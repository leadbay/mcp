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
  it("a submit cancelled BEFORE dispatch never reaches the network", async () => {
    // Superseded contract: this used to assert the POST still landed, on the
    // reasoning that a paid submit may already have committed server-side. That
    // is true only ONCE IT IS ON THE WIRE. A submit still queued behind the
    // client's concurrency slots has provably spent nothing, so cancelling it
    // there is free — and letting it through charged the user for a job they
    // had already cancelled. The in-flight half of the rule is unchanged and is
    // covered in paid-submit-presend-cancel.test.ts.
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
    expect(reqs.filter((r) => r.method === "POST")).toHaveLength(0);
    expect(reqs.filter((r) => r.method === "GET")).toHaveLength(0);
  });
});
