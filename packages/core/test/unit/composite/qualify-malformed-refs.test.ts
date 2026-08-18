/**
 * Malformed `lead_refs` entries are refused, not crashed on.
 *
 * MCP args are not schema-validated before dispatch, and `normalizeLeadRefs`
 * deliberately passes non-strings through untouched (so object refs survive).
 * A `null` therefore reached `derivedRequestId`, whose first property access
 * threw a raw TypeError — BEFORE the spend gate could return a quote. The
 * caller got a stack trace where the contract promises a named error.
 *
 * Dropping the bad entries instead would be worse: the batch would qualify and
 * BILL a subset of what the user listed without saying so.
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

beforeEach(() => resetHttpMock());

async function run(lead_refs: unknown, extra: Record<string, unknown> = {}) {
  mockHttp([]);
  return qualifyLeads.execute(newClient(), {
    lead_refs,
    wait_seconds: 0,
    ...extra,
  } as any);
}

async function refusal(lead_refs: unknown, extra: Record<string, unknown> = {}) {
  try {
    await run(lead_refs, extra);
    return null;
  } catch (e) {
    return e as { code?: string; message?: string; hint?: string };
  }
}

describe("leadbay_qualify_leads — malformed lead_refs", () => {
  it("refuses a null ref with a named error, not a TypeError", async () => {
    const e = await refusal([null], { qualify: true, confirm: true });
    expect(e).toBeTruthy();
    expect(e).not.toBeInstanceOf(TypeError);
    expect(e!.code).toBe("INVALID_LEAD_REF");
  });

  it("refuses before any network call — nothing is submitted", async () => {
    // The whole point: the throw used to happen while deriving the key, which
    // is past the spend gate's quote path. Nothing may reach the wire.
    await refusal([null], { qualify: true, confirm: true });
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("names the offending indexes so the caller can fix the batch", async () => {
    const e = await refusal([{ website: "acme.com" }, null, 42], {
      qualify: true,
      confirm: true,
    });
    expect(e!.code).toBe("INVALID_LEAD_REF");
    expect(e!.message).toMatch(/index 1, 2/);
  });

  it("refuses on the FREE path too — a crash is not free-path-specific", async () => {
    const e = await refusal([null], { qualify: false });
    expect(e!.code).toBe("INVALID_LEAD_REF");
  });

  it("rejects arrays and numbers where a ref object belongs", async () => {
    expect((await refusal([[]], { qualify: false }))!.code).toBe("INVALID_LEAD_REF");
    expect((await refusal([7], { qualify: false }))!.code).toBe("INVALID_LEAD_REF");
  });

  it("still accepts the bare-string shorthand", async () => {
    // The guard runs AFTER normalizeLeadRefs, so a string is already an object
    // by then and must not be called malformed.
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
      lead_refs: ["acme.com"],
      qualify: false,
      wait_seconds: 0,
    } as any);
    const post = getHttpRequests().find((r) => r.method === "POST");
    expect(JSON.parse(post!.body ?? "{}").lead_refs).toEqual([
      { website: "acme.com" },
    ]);
  });
});
