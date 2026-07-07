/**
 * product#3865 — an @leadbay.ai account is "unlimited" ONLY when its billing is
 * DISABLED server-side. When billing is ENABLED (a metered internal org, e.g.
 * freemium or paid), the MCP must treat it as a REAL user: real quota gauge,
 * real credit story, the normal enrichment gate.
 *
 *   @leadbay.ai + billing disabled → unlimited (stay silent on quota/credits)
 *   @leadbay.ai + billing enabled  → real user (metered — show quota, gate credits)
 *   any non-@leadbay.ai email       → real user (unchanged)
 *
 * The backend does not serialize disable_billing, but it hard-codes
 * `billing.seats = 100_000` for disable_billing orgs (OrgPayload.kt); a metered
 * org reports its real (small) seat count. Billing entirely ABSENT (older
 * backend / never wired) also reads as unlimited. Supersedes the earlier
 * email-only contract in unlimited-account.test.ts / enrich-contacts-unlimited
 * .test.ts (both removed with this change).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import {
  isUnlimitedAccount,
  readCreditsRemaining,
  UNLIMITED,
} from "../../../src/composite/_credits-helpers.js";
import { enrichContacts } from "../../../src/tools/enrich-contacts.js";
import { accountStatus } from "../../../src/composite/account-status.js";
import type { UserMePayload } from "../../../src/types.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");
const DISABLED = 100_000; // the disable_billing seat sentinel

const me = (over: Partial<UserMePayload>): UserMePayload =>
  ({ id: "u", organization: { id: "org-1", name: "Co" }, ...over } as UserMePayload);

const withBilling = (email: string, billing: any): UserMePayload =>
  me({ email, organization: { id: "org-1", name: "Co", billing } } as Partial<UserMePayload>);

beforeEach(() => resetHttpMock());

// ─── detection helper ─────────────────────────────────────────────────────────

describe("isUnlimitedAccount — billing-aware", () => {
  it("@leadbay.ai + billing DISABLED (seats sentinel) → unlimited", () => {
    expect(isUnlimitedAccount(withBilling("arty@leadbay.ai", { seats: DISABLED, ai_credits: 0 }))).toBe(true);
  });

  it("@leadbay.ai + billing ABSENT → unlimited (nothing meters it)", () => {
    expect(isUnlimitedAccount(me({ email: "x@leadbay.ai" }))).toBe(true);
  });

  it("@leadbay.ai + billing ENABLED (metered freemium, real seat count) → real user", () => {
    // The live metered arty@leadbay.ai shape: small seats, a real quota, credits 0.
    expect(
      isUnlimitedAccount(
        withBilling("arty@leadbay.ai", { seats: 1, ai_credits: 0, ai_credits_quota: 1000 })
      )
    ).toBe(false);
  });

  it("mixed-case / padded @leadbay.ai still detected, billing disabled → unlimited", () => {
    expect(isUnlimitedAccount(withBilling("  Milstan@LeadBay.AI ", { seats: DISABLED }))).toBe(true);
  });

  it("normal customer email → real user regardless of seats", () => {
    expect(isUnlimitedAccount(withBilling("buyer@acme.com", { seats: DISABLED }))).toBe(false);
    expect(isUnlimitedAccount(me({ email: "buyer@acme.com" }))).toBe(false);
  });

  it("email absent → real user", () => {
    expect(isUnlimitedAccount(me({}))).toBe(false);
  });

  it("lookalike domain → real user", () => {
    expect(isUnlimitedAccount(me({ email: "x@notleadbay.ai.evil.com" }))).toBe(false);
  });
});

// ─── readCreditsRemaining ───────────────────────────────────────────────────

describe("readCreditsRemaining — billing-aware sentinel", () => {
  it("'unlimited' for @leadbay.ai with billing disabled", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.6/users/me",
        status: 200,
        body: { id: "u", email: "x@leadbay.ai", organization: { id: "org-1", billing: { seats: DISABLED, ai_credits: 0 } } },
      },
    ]);
    expect(await readCreditsRemaining(newClient())).toBe(UNLIMITED);
  });

  it("'unlimited' for @leadbay.ai with billing absent", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: { id: "u", email: "x@leadbay.ai", organization: { id: "org-1" } } },
    ]);
    expect(await readCreditsRemaining(newClient())).toBe(UNLIMITED);
  });

  it("numeric balance for @leadbay.ai with billing ENABLED (metered) — no longer 'unlimited'", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.6/users/me",
        status: 200,
        body: { id: "u", email: "x@leadbay.ai", organization: { id: "org-1", billing: { seats: 1, ai_credits: 12 } } },
      },
    ]);
    expect(await readCreditsRemaining(newClient())).toBe(12);
  });

  it("numeric balance for a normal customer", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.6/users/me",
        status: 200,
        body: { id: "u", email: "buyer@acme.com", organization: { id: "org-1", billing: { ai_credits: 42 } } },
      },
    ]);
    expect(await readCreditsRemaining(newClient())).toBe(42);
  });
});

// ─── enrich_contacts gate ────────────────────────────────────────────────────

describe("enrich_contacts — billing-aware unlimited bypass", () => {
  it("@leadbay.ai + billing disabled + ai_credits:0 → NOT blocked (unlimited)", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: { id: "u", email: "x@leadbay.ai", organization: { id: "org-1", billing: { seats: DISABLED, ai_credits: 0 } } } },
      { method: "POST", path: /\/leads\/lead-1\/enrich\/contacts\/c1\/enrich/, status: 204 },
    ]);
    const r: any = await enrichContacts.execute(newClient(), { leadId: "lead-1", contactId: "c1", email: true });
    expect(r.triggered).toBe(true);
    expect(r.credits_remaining).toBe("unlimited");
  });

  it("@leadbay.ai + billing ENABLED + ai_credits:0 → BLOCKED like a real user", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: { id: "u", email: "x@leadbay.ai", organization: { id: "org-1", billing: { seats: 1, ai_credits: 0 } } } },
    ]);
    await expect(
      enrichContacts.execute(newClient(), { leadId: "lead-1", contactId: "c1", email: true })
    ).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
  });
});

// ─── account_status flag ─────────────────────────────────────────────────────

describe("account_status — unlimited_credits is billing-aware", () => {
  const meBody = (email: string, billing?: any) => ({
    email,
    name: "N",
    admin: true,
    manager: false,
    language: "en",
    organization: { id: "org-1", name: "Co", ai_agent_enabled: true, computing_intelligence: false, ...(billing ? { billing } : {}) },
    last_requested_lens: null,
  });

  it("true for @leadbay.ai with billing disabled", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: meBody("x@leadbay.ai", { seats: DISABLED }) },
      { method: "GET", path: "/1.6/users/me", status: 200, body: meBody("x@leadbay.ai", { seats: DISABLED }) },
      { method: "GET", path: "/1.6/organizations/org-1/quota_status", status: 200, body: { plan: null, org: { spend: [], resources: [] } } },
    ]);
    const r: any = await accountStatus.execute(newClient(), {});
    expect(r.organization.unlimited_credits).toBe(true);
  });

  it("false for @leadbay.ai with billing ENABLED (metered freemium)", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: meBody("x@leadbay.ai", { seats: 1, ai_credits_quota: 1000 }) },
      { method: "GET", path: "/1.6/users/me", status: 200, body: meBody("x@leadbay.ai", { seats: 1, ai_credits_quota: 1000 }) },
      { method: "GET", path: "/1.6/organizations/org-1/quota_status", status: 200, body: { plan: "FREEMIUM", user: { spend: [{ current_units: 0, max_units: 1500, window_type: "daily", resets_at: "2026-07-08T00:00:00Z" }], resources: [] } } },
    ]);
    const r: any = await accountStatus.execute(newClient(), {});
    expect(r.organization.unlimited_credits).toBe(false);
  });

  it("false for a normal customer account", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: meBody("buyer@acme.com") },
      { method: "GET", path: "/1.6/users/me", status: 200, body: meBody("buyer@acme.com") },
      { method: "GET", path: "/1.6/organizations/org-1/quota_status", status: 200, body: { plan: "TIER1", org: { spend: [], resources: [] } } },
    ]);
    const r: any = await accountStatus.execute(newClient(), {});
    expect(r.organization.unlimited_credits).toBe(false);
  });
});
