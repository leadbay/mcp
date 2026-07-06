/**
 * product#3851 — enrich_contacts must NOT hard-refuse an internal/unlimited
 * account (@leadbay.ai) even when the wire shows ai_credits: 0 or null. Those
 * accounts have billing disabled server-side and are effectively unlimited, but
 * surface a null/0 balance the old gate misread as "no credits". A normal
 * account with 0 credits must STILL be blocked (regression guard).
 *
 * New file — the existing enrich-contacts.test.ts is never modified.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { enrichContacts } from "../../../src/tools/enrich-contacts.js";

const BASE = "https://api-us.leadbay.app";
const client = () => new LeadbayClient(BASE, "u.test-token");

// Internal account: @leadbay.ai email, billing shows 0 credits on the wire.
const meUnlimitedZero = {
  id: "u",
  email: "arty+snaplock.com@leadbay.ai",
  organization: { id: "org-1", billing: { ai_credits: 0 } },
};
// Internal account with billing entirely absent (also seen in the wild).
const meUnlimitedNoBilling = {
  id: "u",
  email: "someone@leadbay.ai",
  organization: { id: "org-1" },
};
// Normal paying account, genuinely out of credits — must still be blocked.
const meNormalZero = {
  id: "u",
  email: "buyer@acme.com",
  organization: { id: "org-1", billing: { ai_credits: 0 } },
};

beforeEach(() => resetHttpMock());

describe("leadbay_enrich_contacts — unlimited account bypass (product#3851)", () => {
  it("@leadbay.ai with ai_credits:0 is NOT blocked — enrichment fires, credits_remaining='unlimited'", async () => {
    const { requests } = mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: meUnlimitedZero },
      {
        method: "POST",
        path: /\/1\.6\/leads\/L1\/enrich\/contacts\/C1\/enrich/,
        status: 204,
      },
    ]);

    const result: any = await enrichContacts.execute(client(), {
      leadId: "L1",
      contactId: "C1",
    });

    expect(result.triggered).toBe(true);
    expect(result.credits_remaining).toBe("unlimited");
    // The paid enrichment POST actually went out.
    expect(requests.filter((r) => r.path.includes("/enrich"))).toHaveLength(1);
  });

  it("@leadbay.ai with billing absent is also treated as unlimited (not blocked)", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: meUnlimitedNoBilling },
      {
        method: "POST",
        path: /\/1\.6\/leads\/L1\/enrich\/contacts\/C1\/enrich/,
        status: 204,
      },
    ]);

    const result: any = await enrichContacts.execute(client(), {
      leadId: "L1",
      contactId: "C1",
    });

    expect(result.triggered).toBe(true);
    expect(result.credits_remaining).toBe("unlimited");
  });

  it("REGRESSION: a normal account with 0 credits STILL throws QUOTA_EXCEEDED", async () => {
    const { requests } = mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: meNormalZero },
    ]);

    await expect(
      enrichContacts.execute(client(), { leadId: "L1", contactId: "C1" })
    ).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
    // No enrichment POST for a genuinely broke account.
    expect(requests.filter((r) => r.path.includes("/enrich"))).toHaveLength(0);
  });
});
