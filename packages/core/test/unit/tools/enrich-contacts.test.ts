/**
 * Tests for leadbay_enrich_contacts (protocol-agnostic Tool shape).
 * Critical invariants: paid-path fallback to org, paid-success never triggers
 * org (no double-charge), URL literal for query-param drift detection.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
} from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { enrichContacts } from "../../../src/tools/enrich-contacts.js";

const BASE = "https://api-us.leadbay.app";

const meBodyFull = {
  id: "u",
  email: "a@b.com",
  organization: { id: "org-1", billing: { ai_credits: 10 } },
};
const meBodyZeroCredits = {
  id: "u",
  email: "a@b.com",
  organization: { id: "org-1", billing: { ai_credits: 0 } },
};

beforeEach(() => {
  resetHttpMock();
});

function client() {
  return new LeadbayClient(BASE, "u.test-token");
}

describe("leadbay_enrich_contacts — validation", () => {
  it("both email=false and phone=false throws INVALID_PARAMS", async () => {
    mockHttp([]);
    await expect(
      enrichContacts.execute(client(), {
        leadId: "L1",
        contactId: "C1",
        email: false,
        phone: false,
      })
    ).rejects.toMatchObject({ code: "INVALID_PARAMS" });
  });
});

describe("leadbay_enrich_contacts — quota advisory", () => {
  it("quota 0 credits → throws QUOTA_EXCEEDED without enriching", async () => {
    const { requests } = mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: meBodyZeroCredits },
    ]);
    await expect(
      enrichContacts.execute(client(), { leadId: "L1", contactId: "C1" })
    ).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
    expect(requests.filter((r) => r.path.includes("/enrich"))).toHaveLength(0);
  });

  it("advisory-check failure does NOT block enrichment", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 500, body: {} },
      {
        method: "POST",
        path: /\/1\.5\/leads\/L1\/enrich\/contacts\/C1\/enrich/,
        status: 204,
      },
    ]);
    const result: any = await enrichContacts.execute(client(), {
      leadId: "L1",
      contactId: "C1",
    });
    expect(result.triggered).toBe(true);
    expect(result.credits_remaining).toBeNull();
  });
});

describe("leadbay_enrich_contacts — paid → org fallback", () => {
  it("paid path 404 → falls back to org-contacts path", async () => {
    const { requests } = mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: meBodyFull },
      {
        method: "POST",
        path: /\/leads\/L1\/enrich\/contacts\/C1\/enrich/,
        status: 404,
        body: { message: "not found" },
      },
      {
        method: "POST",
        path: /\/leads\/L1\/contacts\/C1\/enrich/,
        status: 204,
      },
    ]);
    const result: any = await enrichContacts.execute(client(), {
      leadId: "L1",
      contactId: "C1",
    });
    expect(result.triggered).toBe(true);

    const paths = requests.map((r) => r.path);
    expect(paths.some((p) => p.includes("/enrich/contacts/"))).toBe(true);
    expect(
      paths.some(
        (p) => p.includes("/leads/L1/contacts/") && p.includes("/enrich")
      )
    ).toBe(true);
  });

  it("paid path 500 error propagates — org path is NOT tried", async () => {
    const { requests } = mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: meBodyFull },
      {
        method: "POST",
        path: /\/leads\/L1\/enrich\/contacts\/C1\/enrich/,
        status: 500,
        body: { message: "boom" },
      },
    ]);
    await expect(
      enrichContacts.execute(client(), { leadId: "L1", contactId: "C1" })
    ).rejects.toMatchObject({ code: "API_ERROR" });

    const orgFallbackCalled = requests.some((r) =>
      /\/leads\/L1\/contacts\//.test(r.path) && /\/enrich$/.test(r.path)
    );
    expect(orgFallbackCalled).toBe(false);
  });

  it("paid success → org endpoint is NOT called (no double-charge)", async () => {
    const { requests } = mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: meBodyFull },
      {
        method: "POST",
        path: /\/leads\/L1\/enrich\/contacts\/C1\/enrich/,
        status: 204,
      },
    ]);
    const result: any = await enrichContacts.execute(client(), {
      leadId: "L1",
      contactId: "C1",
    });
    expect(result.triggered).toBe(true);

    const orgCalled = requests.some(
      (r) =>
        /\/leads\/L1\/contacts\//.test(r.path) && /\/enrich/.test(r.path)
    );
    expect(orgCalled).toBe(false);
  });
});

describe("leadbay_enrich_contacts — URL + response shape", () => {
  it("emits exact URL with email/phone query params as literal strings", async () => {
    const { requests } = mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: meBodyFull },
      {
        method: "POST",
        path: "/1.5/leads/L1/enrich/contacts/C1/enrich?email=true&phone=false",
        status: 204,
      },
    ]);
    await enrichContacts.execute(client(), {
      leadId: "L1",
      contactId: "C1",
      email: true,
      phone: false,
    });
    const paidCall = requests.find((r) =>
      r.path.includes("/enrich/contacts/C1/enrich")
    );
    expect(paidCall!.path).toBe(
      "/1.5/leads/L1/enrich/contacts/C1/enrich?email=true&phone=false"
    );
  });

  it("response includes credits_remaining from advisory check", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: meBodyFull },
      {
        method: "POST",
        path: /\/enrich\/contacts\/.*\/enrich/,
        status: 204,
      },
    ]);
    const result: any = await enrichContacts.execute(client(), {
      leadId: "L1",
      contactId: "C1",
    });
    expect(result.credits_remaining).toBe(10);
    expect(result.email_requested).toBe(true);
    expect(result.phone_requested).toBe(true);
  });
});
