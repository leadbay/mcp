/**
 * The exclusion list that is COUNTED is the exclusion list that is SENT.
 *
 * `rejectOversizedExclusions` counts `canonicalIdSet(ids)` — deduped and
 * UUID-folded — while the submit body used to post `params.exclude_lead_ids`
 * raw. A 600-entry array that collapses to 400 therefore cleared the local
 * guard and was still refused by the backend, on the top-up call the user had
 * already paid toward.
 *
 * The body now posts the canonical list, which also matches what the
 * idempotency key was derived from.
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
import { findNewLeads } from "../../../src/composite/find-new-leads.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.tok", "us");

const UUID_A = "7b3c1de2-5f40-4a9c-9d21-0c8ea4f61b55";
const UUID_B = "9f2e8a10-3c77-4b6d-8e12-5a4b7c9d0e33";

beforeEach(() => resetHttpMock());

async function submittedBody(extra: Record<string, unknown>): Promise<any> {
  mockHttp([
    {
      method: "POST",
      path: "/1.6/mcp/search",
      status: 200,
      body: { job_id: "job-1", state: "queued", items: [] },
    },
    {
      method: "GET",
      path: /^\/1\.6\/mcp\/jobs\//,
      status: 200,
      body: {
        job: { id: "job-1", state: "succeeded" },
        funnel: { delivered: 0, examined: 0 },
        items: [],
      },
    },
  ]);
  await findNewLeads.execute(newClient(), {
    example_lead: { description: "independent gym, 2 sites" },
    count: 5,
    request_id: "wire-test",
    wait_seconds: 0,
    ...extra,
  } as any);
  const post = getHttpRequests().find(
    (r) => r.method === "POST" && r.path.endsWith("/mcp/search")
  );
  return JSON.parse(post!.body ?? "{}");
}

describe("leadbay_find_new_leads — exclude_lead_ids on the wire", () => {
  it("posts the canonical list, not the raw array", async () => {
    const body = await submittedBody({
      exclude_lead_ids: [UUID_A, UUID_A.toUpperCase(), UUID_B, "  "],
    });
    // Deduped case-insensitively, blanks dropped — exactly what the cap guard
    // counted.
    expect(body.exclude_lead_ids).toEqual([UUID_A, UUID_B].sort());
  });

  it("a list that only repeats itself is sent deduped, not refused", async () => {
    const many = Array.from({ length: 600 }, () => UUID_A);
    const body = await submittedBody({ exclude_lead_ids: many });
    expect(body.exclude_lead_ids).toEqual([UUID_A]);
  });

  it("omits the key entirely when no exclusions were given", async () => {
    // compactBody drops undefined; sending [] instead would be a different
    // request body for the same ask.
    const body = await submittedBody({});
    expect("exclude_lead_ids" in body).toBe(false);
  });
});
