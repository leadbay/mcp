/**
 * String shorthand in `lead_refs` for leadbay_qualify_leads.
 *
 * MCP args arrive unvalidated and `coerceArrayParams` wraps a scalar, so
 * `lead_refs: "acme.com"` reaches the tool as `["acme.com"]` — a STRING where
 * the schema promises an object. Read as an object it yields an all-null ref,
 * so every string ref canonicalized identically: two different companies
 * derived the SAME `qualify-auto-*` request_id and the second batch would
 * dedupe onto the first PAID job. The raw string was also posted as-is, which
 * the backend rejects after this tool already promised a quote.
 *
 * These tests pin the reshape: the submitted body carries the documented
 * object shape, and two different companies no longer share a key.
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
import { qualifyLeads } from "../../../src/composite/qualify-leads.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.tok", "us");

const LEAD_UUID = "7b3c1de2-5f40-4a9c-9d21-0c8ea4f61b55";

const DRY_RUN_200 = {
  valid: true,
  items_requested: 1,
  estimated_cost: { max: 94, unit: "cost_cents" },
};

beforeEach(() => resetHttpMock());

/** Drive the FREE path so no consent gate is involved: qualify:false, no
 *  channels. The submit body is what we assert on. */
async function submittedBody(lead_refs: unknown): Promise<any> {
  mockHttp([
    {
      method: "POST",
      path: "/1.6/mcp/qualify",
      status: 200,
      body: { job_id: "job-1", state: "queued", items: [] },
    },
    {
      method: "GET",
      // The poller appends cursor params, so match the route, not an exact path.
      path: /^\/1\.6\/mcp\/jobs\//,
      status: 200,
      body: {
        job: { id: "job-1", state: "succeeded" },
        funnel: { delivered: 0, examined: 0 },
        items: [],
      },
    },
  ]);
  await qualifyLeads.execute(newClient(), {
    lead_refs,
    qualify: false,
    wait_seconds: 0,
  } as any);
  const post = getHttpRequests().find(
    (r) => r.method === "POST" && r.path.endsWith("/mcp/qualify")
  );
  return JSON.parse(post!.body ?? "{}");
}

/** The PAID path, consented, so a `request_id` is actually derived. */
async function paidSubmittedBody(lead_refs: unknown): Promise<any> {
  mockHttp([
    {
      method: "POST",
      path: "/1.6/mcp/qualify",
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
  await qualifyLeads.execute(newClient(), {
    lead_refs,
    qualify: true,
    confirm: true,
    wait_seconds: 0,
  } as any);
  const post = getHttpRequests().find(
    (r) => r.method === "POST" && r.path.endsWith("/mcp/qualify")
  );
  return JSON.parse(post!.body ?? "{}");
}

describe("leadbay_qualify_leads — string lead_refs", () => {
  it("a bare domain becomes {website}, not a string the backend 400s on", async () => {
    const body = await submittedBody(["acme.com"]);
    expect(body.lead_refs).toEqual([{ website: "acme.com" }]);
  });

  it("a UUID becomes {lead_id}", async () => {
    const body = await submittedBody([LEAD_UUID]);
    expect(body.lead_refs).toEqual([{ lead_id: LEAD_UUID }]);
  });

  it("a non-domain, non-UUID string becomes {name}", async () => {
    const body = await submittedBody(["Franklin Barbecue"]);
    expect(body.lead_refs).toEqual([{ name: "Franklin Barbecue" }]);
  });

  it("a scalar (not a list) is still reshaped after coercion", async () => {
    const body = await submittedBody("acme.com");
    expect(body.lead_refs).toEqual([{ website: "acme.com" }]);
  });

  it("object refs pass through untouched", async () => {
    const body = await submittedBody([{ website: "acme.com", name: "Acme" }]);
    expect(body.lead_refs).toEqual([{ website: "acme.com", name: "Acme" }]);
  });

  it("two different companies no longer derive the same request_id", async () => {
    // The collapse that mattered, and it only bites on the PAID path — that is
    // where a key is derived. Read as objects, every string ref produced an
    // all-null canonical form, so two unrelated companies hashed to the same
    // `qualify-auto-*` key and the second paid batch deduped onto the first job.
    const a = await paidSubmittedBody(["acme.com"]);
    const b = await paidSubmittedBody(["globex.com"]);
    expect(a.request_id).toBeTruthy();
    expect(b.request_id).toBeTruthy();
    expect(a.request_id).not.toEqual(b.request_id);
  });
});
