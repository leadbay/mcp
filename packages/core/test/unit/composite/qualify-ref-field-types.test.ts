/**
 * Lead-ref FIELD types are validated, not just the ref container.
 *
 * The first guard checked that each entry was an object. `{website: 123}`
 * cleared it and then died one level in: `normalizeDomain` returns null for a
 * non-string, so the `??` fallback ran `123.trim()` — a raw TypeError while
 * deriving the automatic idempotency key, again BEFORE the spend gate could
 * return its quote. `name` and `location` had the same hole via `?.trim()`,
 * which guards null/undefined but not a number.
 *
 * Two layers are pinned here: the guard rejects non-string fields with
 * INVALID_LEAD_REF, and key derivation itself no longer throws on one — so a
 * future caller that reaches it without the guard degrades instead of crashing.
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

/** The PAID, unkeyed path — the one that derives a fallback request_id. */
async function refusal(lead_refs: unknown) {
  mockHttp([]);
  try {
    await qualifyLeads.execute(newClient(), {
      lead_refs,
      qualify: true,
      confirm: true,
      wait_seconds: 0,
    } as any);
    return null;
  } catch (e) {
    return e as { code?: string; message?: string };
  }
}

const OK_JOB = [
  {
    method: "POST" as const,
    path: "/1.6/mcp/qualify",
    status: 200,
    body: { job_id: "job-1", state: "queued", items: [] },
  },
  {
    method: "GET" as const,
    path: /^\/1\.6\/mcp\/jobs\//,
    status: 200,
    body: {
      job: { id: "job-1", state: "succeeded" },
      funnel: { delivered: 0, examined: 0 },
      items: [],
    },
  },
];

describe("leadbay_qualify_leads — lead-ref field types", () => {
  it("refuses a numeric website instead of throwing a TypeError", async () => {
    const e = await refusal([{ website: 123 }]);
    expect(e).toBeTruthy();
    expect(e).not.toBeInstanceOf(TypeError);
    expect(e!.code).toBe("INVALID_LEAD_REF");
    expect(e!.message).toMatch(/0\.website \(number\)/);
  });

  it("refuses non-string name and location too", async () => {
    expect((await refusal([{ name: 42 }]))!.message).toMatch(/0\.name \(number\)/);
    expect((await refusal([{ location: {} }]))!.message).toMatch(
      /0\.location \(object\)/
    );
  });

  it("refuses an explicit null field", async () => {
    // `?? null` and `?.` both tolerate null, so this never crashed — but it is
    // still not a usable identifier and must not reach the backend silently.
    expect((await refusal([{ website: null }]))!.message).toMatch(
      /0\.website \(null\)/
    );
  });

  it("refuses nothing before the wire — no submit happens", async () => {
    await refusal([{ website: 123 }]);
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("reports every bad field across every ref", async () => {
    const e = await refusal([{ website: "acme.com" }, { name: 1, location: 2 }]);
    expect(e!.message).toMatch(/1\.name/);
    expect(e!.message).toMatch(/1\.location/);
    expect(e!.message).not.toMatch(/0\./);
  });

  it("still accepts absent fields and well-formed refs", async () => {
    mockHttp(OK_JOB);
    await qualifyLeads.execute(newClient(), {
      lead_refs: [{ website: "acme.com" }, { name: "Acme", location: "Paris" }],
      qualify: false,
      wait_seconds: 0,
    } as any);
    expect(
      getHttpRequests().filter((r) => r.method === "POST")
    ).toHaveLength(1);
  });
});
