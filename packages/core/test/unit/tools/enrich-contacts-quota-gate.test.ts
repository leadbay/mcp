/**
 * product#3865 — enrich_contacts is gated by QUOTA (backend 429), not a
 * client-side credit balance. The old client gate threw QUOTA_EXCEEDED when
 * `billing.ai_credits <= 0`, but ai_credits is credits CONSUMED (an accumulator
 * starting at 0), so it falsely blocked freemium/fresh accounts that still had
 * quota left. That pre-refusal is removed: the client never blocks on credits;
 * only a real backend 429 gates. Supersedes the credit-gate contract in the
 * removed enrich-contacts-unlimited.test.ts (product#3851), whose still-valid
 * @leadbay.ai unlimited-bypass cases are carried over here.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { enrichContacts } from "../../../src/tools/enrich-contacts.js";

const BASE = "https://api-us.leadbay.app";
const client = () => new LeadbayClient(BASE, "u.test-token");

// Internal @leadbay.ai account, ai_credits:0 on the wire → unlimited bypass.
const meUnlimitedZero = {
  id: "u",
  email: "arty+snaplock.com@leadbay.ai",
  organization: { id: "org-1", billing: { ai_credits: 0 } },
};
// Internal @leadbay.ai with billing absent.
const meUnlimitedNoBilling = {
  id: "u",
  email: "someone@leadbay.ai",
  organization: { id: "org-1" },
};
// Normal (non-internal) account, credit counter at 0 — must NO LONGER be
// pre-blocked (quota, enforced by the backend, is the real gate).
const meNormalZero = {
  id: "u",
  email: "buyer@acme.com",
  organization: { id: "org-1", billing: { ai_credits: 0 } },
};

beforeEach(() => resetHttpMock());

describe("leadbay_enrich_contacts — quota, not credits, is the gate", () => {
  it("normal account with 0 credits is NOT pre-blocked — enrichment fires", async () => {
    // The removed test asserted this threw QUOTA_EXCEEDED. It must now proceed:
    // ai_credits is consumed-not-remaining, so 0 ≠ out of quota.
    const { requests } = mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: meNormalZero },
      { method: "POST", path: /\/1\.6\/leads\/L1\/enrich\/contacts\/C1\/enrich/, status: 204 },
    ]);
    const result: any = await enrichContacts.execute(client(), { leadId: "L1", contactId: "C1" });
    expect(result.triggered).toBe(true);
    expect(requests.filter((r) => r.path.includes("/enrich"))).toHaveLength(1);
  });

  it("only a real backend 429 blocks (QUOTA_EXCEEDED propagates)", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: meNormalZero },
      {
        method: "POST",
        path: /\/1\.6\/leads\/L1\/enrich\/contacts\/C1\/enrich/,
        status: 429,
        body: { code: "QUOTA_EXCEEDED", message: "window exhausted" },
      },
    ]);
    await expect(
      enrichContacts.execute(client(), { leadId: "L1", contactId: "C1" })
    ).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
  });

  it("@leadbay.ai with ai_credits:0 → unlimited bypass, enrichment fires", async () => {
    const { requests } = mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: meUnlimitedZero },
      { method: "POST", path: /\/1\.6\/leads\/L1\/enrich\/contacts\/C1\/enrich/, status: 204 },
    ]);
    const result: any = await enrichContacts.execute(client(), { leadId: "L1", contactId: "C1" });
    expect(result.triggered).toBe(true);
    expect(result.credits_remaining).toBe("unlimited");
    expect(requests.filter((r) => r.path.includes("/enrich"))).toHaveLength(1);
  });

  it("@leadbay.ai with billing absent → unlimited bypass, enrichment fires", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: meUnlimitedNoBilling },
      { method: "POST", path: /\/1\.6\/leads\/L1\/enrich\/contacts\/C1\/enrich/, status: 204 },
    ]);
    const result: any = await enrichContacts.execute(client(), { leadId: "L1", contactId: "C1" });
    expect(result.triggered).toBe(true);
    expect(result.credits_remaining).toBe("unlimited");
  });
});
