/**
 * A 429 on leadbay_enrich_contacts is account-wide: every other contact fails
 * the same way until the window resets. The generic QUOTA_EXCEEDED hint only
 * says "wait, then retry", so an agent enriching a list moved on to the next
 * contact and spent the batch on failed calls. The tool now prefixes a hint
 * that tells the agent to stop the batch, on both enrich paths, and keeps the
 * code, the generic hint and the 429 metadata.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { enrichContacts } from "../../../src/tools/enrich-contacts.js";

const STOP = /^The enrichment quota is shared by every contact on the account.*Stop the batch now/;

const BASE = "https://api-us.leadbay.app";
const client = () => new LeadbayClient(BASE, "u.test-token");

const me = {
  id: "u",
  email: "buyer@acme.com",
  organization: { id: "org-1", billing: { ai_credits: 3 } },
};

beforeEach(() => resetHttpMock());

describe("leadbay_enrich_contacts — a quota 429 stops the batch", () => {
  it("paid path 429 → QUOTA_EXCEEDED with the stop-the-batch hint first", async () => {
    const { requests } = mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: me },
      {
        method: "POST",
        path: /\/1\.6\/leads\/L1\/enrich\/contacts\/C1\/enrich/,
        status: 429,
        body: { error: "quota_exceeded" },
      },
    ]);
    const err: any = await enrichContacts
      .execute(client(), { leadId: "L1", contactId: "C1" })
      .catch((e) => e);
    expect(err.code).toBe("QUOTA_EXCEEDED");
    expect(err.hint).toMatch(STOP);
    expect(err._meta.http_status).toBe(429);
    expect(requests.filter((r) => r.method === "POST")).toHaveLength(1);
  });

  it("org fallback path 429 gets the same hint", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: me },
      {
        method: "POST",
        path: /\/1\.6\/leads\/L1\/enrich\/contacts\/C1\/enrich/,
        status: 404,
        body: { message: "not found" },
      },
      {
        method: "POST",
        path: /\/1\.6\/leads\/L1\/contacts\/C1\/enrich/,
        status: 429,
        body: { error: "quota_exceeded" },
        responseHeaders: { "retry-after": "120" },
      },
    ]);
    const err: any = await enrichContacts
      .execute(client(), { leadId: "L1", contactId: "C1" })
      .catch((e) => e);
    expect(err.code).toBe("QUOTA_EXCEEDED");
    expect(err.hint).toMatch(STOP);
    expect(err._meta.retry_after).toBe(120);
  });

  it("other errors keep their own hint", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: me },
      {
        method: "POST",
        path: /\/1\.6\/leads\/L1\/enrich\/contacts\/C1\/enrich/,
        status: 500,
        body: { message: "boom" },
      },
    ]);
    const err: any = await enrichContacts
      .execute(client(), { leadId: "L1", contactId: "C1" })
      .catch((e) => e);
    expect(err.hint ?? "").not.toMatch(/enrichment quota is shared/);
  });
});
