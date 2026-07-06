/**
 * Consent gate for leadbay_enrich_titles (product#3848).
 *
 * The bug: a bare "enrich these titles" call left `email` defaulted ON, so a
 * PAID email reveal launched silently — the user asked for "title & LinkedIn
 * only" (both already free on the contact) and got 97 contacts email-enriched
 * without confirmation.
 *
 * The fix gates the LAUNCH on consent, keyed on ctx.elicit (wired in production
 * for this tool; absent in unit tests / OpenClaw). This file proves:
 *   - elicit present + user declines → mode:"needs_confirmation", NO /launch.
 *   - elicit present + user accepts → launches.
 *   - explicit email:true (no elicit) → launches (explicit channel = consent).
 *   - confirm:true (no elicit) → launches (confirm override).
 *   - no channel + no elicit → launches (intentional back-compat; keeps the
 *     pinned bulk-enrich-flow suite green).
 *   - dry_run:true → mode:"dry_run", elicit never consulted (gate placement).
 *
 * New file (existing test files are never modified).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
} from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { enrichTitles } from "../../../src/composite/enrich-titles.js";
import { InMemoryBulkStore } from "../../../src/jobs/bulk-store.js";
import type { ToolContext } from "../../../src/types.js";

const BASE = "https://api-us.leadbay.app";
const LENS_ID = 7;
const LEAD_A = "lead-a";
const TITLE = "CEO";

const meBody = {
  id: "u",
  email: "a@b.com",
  organization: { id: "org-1", billing: { ai_credits: 10 } },
};

const previewBody = {
  enrichable_contacts: 5,
  title_suggestions: [],
  auto_included_titles: [],
  previously_enriched_titles: [],
};

const newClient = () => new LeadbayClient(BASE, "u.test-token");

// The select → job_titles → preview → clear sequence common to every branch.
// A launch fixture is appended ONLY where a launch is expected, so any
// unexpected /launch throws (undeclared endpoint) and fails the test loudly.
function baseFlow(opts: { withCredits?: boolean; withLaunch?: boolean } = {}) {
  const seq: any[] = [
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
  ];
  if (opts.withCredits) {
    seq.push({
      method: "GET",
      path: "/1.6/users/me",
      status: 200,
      body: meBody,
    });
  }
  if (opts.withLaunch) {
    seq.push({
      method: "POST",
      path: "/1.6/leads/selection/enrichment/launch",
      status: 204,
    });
  }
  seq.push({ method: "POST", path: "/1.6/leads/selection/clear", status: 204 });
  return mockHttp(seq);
}

function launchCalls(requests: { path: string }[]) {
  return requests.filter((r) => /\/enrichment\/launch/.test(r.path));
}

beforeEach(() => resetHttpMock());

describe("enrich_titles consent gate (#3848)", () => {
  it("elicit present + user declines → needs_confirmation, NO paid launch", async () => {
    // needs_confirmation reads credits (GET /users/me) before returning.
    const { requests } = baseFlow({ withCredits: true });
    const elicit = vi.fn(async () => ({ action: "decline" as const }));
    const ctx: ToolContext = {
      bulkTracker: new InMemoryBulkStore(),
      elicit,
    };

    const res: any = await enrichTitles.execute(
      newClient(),
      { leadIds: [LEAD_A], lensId: LENS_ID, titles: [TITLE] }, // channels defaulted — the bug shape
      ctx
    );

    expect(res.mode).toBe("needs_confirmation");
    expect(res.launched).toBe(false);
    expect(res.would_launch).toEqual({ titles: [TITLE], email: true, phone: false });
    expect(res.credits_remaining).toBe(10);
    expect(elicit).toHaveBeenCalledTimes(1);
    // The load-bearing assertion: nothing was spent.
    expect(launchCalls(requests)).toHaveLength(0);
  });

  it("elicit present + user cancels → needs_confirmation, NO launch", async () => {
    const { requests } = baseFlow({ withCredits: true });
    const ctx: ToolContext = {
      bulkTracker: new InMemoryBulkStore(),
      elicit: async () => ({ action: "cancel" as const }),
    };

    const res: any = await enrichTitles.execute(
      newClient(),
      { leadIds: [LEAD_A], lensId: LENS_ID, titles: [TITLE] },
      ctx
    );

    expect(res.mode).toBe("needs_confirmation");
    expect(launchCalls(requests)).toHaveLength(0);
  });

  it("elicit present + user accepts → launches", async () => {
    const { requests } = baseFlow({ withLaunch: true });
    const elicit = vi.fn(async () => ({
      action: "accept" as const,
      content: { confirm: true },
    }));
    const ctx: ToolContext = {
      bulkTracker: new InMemoryBulkStore(),
      elicit,
    };

    const res: any = await enrichTitles.execute(
      newClient(),
      { leadIds: [LEAD_A], lensId: LENS_ID, titles: [TITLE] },
      ctx
    );

    expect(res.mode).toBe("launched");
    expect(res.bulk_id).toBeTruthy();
    expect(elicit).toHaveBeenCalledTimes(1);
    expect(launchCalls(requests)).toHaveLength(1);
  });

  it("elicit present + accept with content.confirm:false → withheld", async () => {
    const { requests } = baseFlow({ withCredits: true });
    const ctx: ToolContext = {
      bulkTracker: new InMemoryBulkStore(),
      elicit: async () => ({
        action: "accept" as const,
        content: { confirm: false },
      }),
    };

    const res: any = await enrichTitles.execute(
      newClient(),
      { leadIds: [LEAD_A], lensId: LENS_ID, titles: [TITLE] },
      ctx
    );

    expect(res.mode).toBe("needs_confirmation");
    expect(launchCalls(requests)).toHaveLength(0);
  });

  it("explicit email:true (no elicit) → launches, no confirmation needed", async () => {
    const { requests } = baseFlow({ withLaunch: true });
    const ctx: ToolContext = { bulkTracker: new InMemoryBulkStore() };

    const res: any = await enrichTitles.execute(
      newClient(),
      { leadIds: [LEAD_A], lensId: LENS_ID, titles: [TITLE], email: true },
      ctx
    );

    expect(res.mode).toBe("launched");
    expect(launchCalls(requests)).toHaveLength(1);
  });

  it("confirm:true (no elicit) → launches with default email channel", async () => {
    const { requests } = baseFlow({ withLaunch: true });
    const ctx: ToolContext = { bulkTracker: new InMemoryBulkStore() };

    const res: any = await enrichTitles.execute(
      newClient(),
      { leadIds: [LEAD_A], lensId: LENS_ID, titles: [TITLE], confirm: true },
      ctx
    );

    expect(res.mode).toBe("launched");
    expect(res.email).toBe(true);
    expect(launchCalls(requests)).toHaveLength(1);
  });

  it("explicit email:true even WITH elicit → launches without eliciting", async () => {
    const { requests } = baseFlow({ withLaunch: true });
    const elicit = vi.fn(async () => ({ action: "decline" as const }));
    const ctx: ToolContext = {
      bulkTracker: new InMemoryBulkStore(),
      elicit,
    };

    const res: any = await enrichTitles.execute(
      newClient(),
      { leadIds: [LEAD_A], lensId: LENS_ID, titles: [TITLE], email: true },
      ctx
    );

    expect(res.mode).toBe("launched");
    expect(elicit).not.toHaveBeenCalled();
    expect(launchCalls(requests)).toHaveLength(1);
  });

  it("no channel + no elicit → launches (back-compat; keeps pinned suite green)", async () => {
    const { requests } = baseFlow({ withLaunch: true });
    const ctx: ToolContext = { bulkTracker: new InMemoryBulkStore() };

    const res: any = await enrichTitles.execute(
      newClient(),
      { leadIds: [LEAD_A], lensId: LENS_ID, titles: [TITLE] },
      ctx
    );

    expect(res.mode).toBe("launched");
    expect(launchCalls(requests)).toHaveLength(1);
  });

  it("dry_run:true → dry_run before the gate; elicit never consulted, no launch", async () => {
    const { requests } = baseFlow({ withCredits: true });
    const elicit = vi.fn(async () => ({ action: "accept" as const }));
    const ctx: ToolContext = {
      bulkTracker: new InMemoryBulkStore(),
      elicit,
    };

    const res: any = await enrichTitles.execute(
      newClient(),
      { leadIds: [LEAD_A], lensId: LENS_ID, titles: [TITLE], dry_run: true },
      ctx
    );

    expect(res.mode).toBe("dry_run");
    expect(elicit).not.toHaveBeenCalled();
    expect(launchCalls(requests)).toHaveLength(0);
  });
});
