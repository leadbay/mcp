/**
 * product#3851 — internal/unlimited accounts (@leadbay.ai) have billing disabled
 * server-side and are effectively unlimited, but surface plan:null and a null/0
 * balance on the wire. The MCP detects them from the email domain and represents
 * credits as "unlimited" (a JSON-serializable sentinel — Infinity would collapse
 * back to null over structuredContent) so the agent proceeds and stays silent on
 * credits instead of misreading null as "no credits".
 *
 * New file — existing credit/account tests are never modified.
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
import { enrichTitles } from "../../../src/composite/enrich-titles.js";
import { bulkEnrichStatus } from "../../../src/composite/bulk-enrich-status.js";
import { accountStatus } from "../../../src/composite/account-status.js";
import { InMemoryBulkStore } from "../../../src/jobs/bulk-store.js";
import type { UserMePayload } from "../../../src/types.js";

const BASE = "https://api-us.leadbay.app";
const LENS_ID = 7;
const LEAD_A = "lead-a";
const TITLE = "CEO";

const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

const previewBody = {
  enrichable_contacts: 5,
  title_suggestions: [],
  auto_included_titles: [],
  previously_enriched_titles: [],
};

function contact(id: string, enrichment: any) {
  return {
    id,
    first_name: id,
    last_name: "",
    email: `${id}@x.com`,
    phone_number: null,
    linkedin_page: null,
    job_title: TITLE,
    recommended: true,
    enrichment,
  };
}

const me = (over: Partial<UserMePayload>): UserMePayload =>
  ({ id: "u", organization: { id: "org-1", name: "Co" }, ...over } as UserMePayload);

beforeEach(() => resetHttpMock());

// ─── detection helper ───────────────────────────────────────────────────────

describe("isUnlimitedAccount", () => {
  it("true for an @leadbay.ai email", () => {
    expect(isUnlimitedAccount(me({ email: "arty+snaplock.com@leadbay.ai" }))).toBe(true);
  });

  it("true for a mixed-case / padded @leadbay.ai email", () => {
    expect(isUnlimitedAccount(me({ email: "  Milstan@LeadBay.AI " }))).toBe(true);
  });

  it("false for a normal customer email", () => {
    expect(isUnlimitedAccount(me({ email: "buyer@acme.com" }))).toBe(false);
  });

  it("false when email is absent", () => {
    expect(isUnlimitedAccount(me({}))).toBe(false);
  });

  it("false for a lookalike domain (not exactly @leadbay.ai)", () => {
    expect(isUnlimitedAccount(me({ email: "x@notleadbay.ai.evil.com" }))).toBe(false);
  });
});

// ─── readCreditsRemaining sentinel ────────────────────────────────────────────

describe("readCreditsRemaining — unlimited sentinel", () => {
  it("returns 'unlimited' for an @leadbay.ai account even when billing is absent", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.6/users/me",
        status: 200,
        body: { id: "u", email: "x@leadbay.ai", organization: { id: "org-1" } },
      },
    ]);
    expect(await readCreditsRemaining(newClient())).toBe(UNLIMITED);
  });

  it("returns 'unlimited' for an @leadbay.ai account even when ai_credits is 0", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.6/users/me",
        status: 200,
        body: {
          id: "u",
          email: "x@leadbay.ai",
          organization: { id: "org-1", billing: { ai_credits: 0 } },
        },
      },
    ]);
    expect(await readCreditsRemaining(newClient())).toBe("unlimited");
  });

  it("still returns the numeric balance for a normal account", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.6/users/me",
        status: 200,
        body: {
          id: "u",
          email: "buyer@acme.com",
          organization: { id: "org-1", billing: { ai_credits: 42 } },
        },
      },
    ]);
    expect(await readCreditsRemaining(newClient())).toBe(42);
  });
});

// ─── enrich_titles surfaces the sentinel ──────────────────────────────────────

describe("enrich_titles — surfaces credits_remaining='unlimited' for internal accounts", () => {
  it("dry_run on an @leadbay.ai account returns credits_remaining='unlimited'", async () => {
    const tracker = new InMemoryBulkStore();
    mockHttp([
      { method: "POST", path: /\/leads\/selection\/select/, status: 204 },
      {
        method: "GET",
        path: "/1.6/leads/selection/enrichment/job_titles",
        status: 200,
        body: [TITLE],
      },
      {
        method: "POST",
        path: "/1.6/leads/selection/enrichment/preview",
        status: 200,
        body: previewBody,
      },
      {
        method: "GET",
        path: "/1.6/users/me",
        status: 200,
        body: { id: "u", email: "x@leadbay.ai", organization: { id: "org-1" } },
      },
      { method: "POST", path: "/1.6/leads/selection/clear", status: 204 },
    ]);

    const res: any = await enrichTitles.execute(
      newClient(),
      { leadIds: [LEAD_A], lensId: LENS_ID, titles: [TITLE], dry_run: true },
      { bulkTracker: tracker }
    );

    expect(res.mode).toBe("dry_run");
    expect(res.enrichable_contacts).toBe(5);
    expect(res.credits_remaining).toBe("unlimited");
  });
});

// ─── bulk_enrich_status surfaces the sentinel ─────────────────────────────────

describe("bulk_enrich_status — credits_remaining='unlimited' at all_done for internal accounts", () => {
  it("re-reads balance as 'unlimited' for an @leadbay.ai account", async () => {
    const tracker = new InMemoryBulkStore();
    const { record } = await tracker.findOrCreatePending({
      lead_ids: [LEAD_A],
      titles: [TITLE],
      email: true,
      phone: false,
      lens_id: LENS_ID,
      selection_source: "explicit",
    });
    await tracker.markLaunched(record.bulk_id);

    mockHttp([
      {
        method: "GET",
        path: /\/leads\/lead-a\/contacts\?IncludeEnriched=true/,
        status: 200,
        body: [contact("c1", { done: true, credits_used: 2 })],
      },
      {
        method: "GET",
        path: /\/leads\/lead-a\/enrich\/contacts\?IncludeEnriched=true/,
        status: 200,
        body: [],
      },
      {
        method: "GET",
        path: "/1.6/users/me",
        status: 200,
        body: { id: "u", email: "x@leadbay.ai", organization: { id: "org-1", billing: { ai_credits: 0 } } },
      },
    ]);

    const status: any = await bulkEnrichStatus.execute(
      newClient(),
      { bulk_id: record.bulk_id },
      { bulkTracker: tracker }
    );

    expect(status.all_done).toBe(true);
    expect(status.credits_remaining).toBe("unlimited");
  });
});

// ─── account_status positive flag ─────────────────────────────────────────────

describe("account_status — organization.unlimited_credits", () => {
  const meBody = (email: string) => ({
    email,
    name: "N",
    admin: true,
    manager: false,
    language: "en",
    organization: { id: "org-1", name: "Co", ai_agent_enabled: true, computing_intelligence: false },
    last_requested_lens: null,
  });

  it("true for an @leadbay.ai account", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: meBody("x@leadbay.ai") },
      { method: "GET", path: "/1.6/users/me", status: 200, body: meBody("x@leadbay.ai") },
      { method: "GET", path: "/1.6/organizations/org-1/quota_status", status: 200, body: { plan: null, org: { spend: [], resources: [] } } },
    ]);
    const r: any = await accountStatus.execute(newClient(), {});
    expect(r.organization.unlimited_credits).toBe(true);
  });

  it("false for a normal account", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: meBody("buyer@acme.com") },
      { method: "GET", path: "/1.6/users/me", status: 200, body: meBody("buyer@acme.com") },
      { method: "GET", path: "/1.6/organizations/org-1/quota_status", status: 200, body: { plan: "TIER1", org: { spend: [], resources: [] } } },
    ]);
    const r: any = await accountStatus.execute(newClient(), {});
    expect(r.organization.unlimited_credits).toBe(false);
  });
});
