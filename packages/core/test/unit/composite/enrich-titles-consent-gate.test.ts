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
//
// The consent gate splits the flow into two lock phases (product#3848 review):
//   phase 1 (preview): select → job_titles → preview → clear
//   phase 2 (launch, only on consent): select → launch → clear
// so the launch path issues a SECOND select + clear. withLaunch appends that
// whole phase-2 leg. The harness matches by (method, path) among unconsumed
// scripts regardless of order, so declaring the right multiplicity is enough.
// A user/me (readCreditsRemaining) is added when the elicit branch runs.
function baseFlow(opts: { withCredits?: boolean; withLaunch?: boolean } = {}) {
  const seq: any[] = [
    // phase 1: preview under the lock
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
    { method: "POST", path: "/1.6/leads/selection/clear", status: 204 },
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
    // phase 2: re-select → launch → clear, under a fresh lock
    seq.push(
      { method: "POST", path: /\/leads\/selection\/select/, status: 204 },
      {
        method: "POST",
        path: "/1.6/leads/selection/enrichment/launch",
        status: 204,
      },
      { method: "POST", path: "/1.6/leads/selection/clear", status: 204 }
    );
  }
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

  it("NO titles + phone:false → free discovery still runs (not BAD_INPUT) (Codex P2)", async () => {
    // Discovery (no titles) is a FREE read; the "one channel must be true" rule
    // only gates the paid launch/dry-run path. A caller that spells out the
    // default phone:false while omitting titles must still get the title menu.
    const { requests } = mockHttp([
      { method: "POST", path: /\/leads\/selection\/select/, status: 204 },
      {
        method: "GET",
        path: "/1.6/leads/selection/enrichment/job_titles",
        status: 200,
        body: [TITLE, "CFO"],
      },
      {
        method: "POST",
        path: "/1.6/leads/selection/enrichment/preview",
        status: 200,
        body: { ...previewBody, title_suggestions: ["CFO"] },
      },
      { method: "GET", path: "/1.6/users/me", status: 200, body: meBody },
      { method: "POST", path: "/1.6/leads/selection/clear", status: 204 },
    ]);
    const ctx: ToolContext = { bulkTracker: new InMemoryBulkStore() };

    const res: any = await enrichTitles.execute(
      newClient(),
      { leadIds: [LEAD_A], lensId: LENS_ID, phone: false }, // no titles + disabled channel flag
      ctx
    );

    expect(res.code).not.toBe("BAD_INPUT");
    expect(res.mode).toBe("discover");
    expect(res.available_titles).toContain(TITLE);
    expect(launchCalls(requests)).toHaveLength(0);
  });

  it("phone:false (a DISABLED flag) is treated like no channel → email default, still gated", async () => {
    // A merely disabled flag doesn't count as "picking a channel" (keying off
    // ENABLED channels). So {titles, phone:false} behaves like a bare call:
    // email defaults on, and consent still gates it — a declining elicit yields
    // needs_confirmation, no spend. (Round-4: phone:false no longer trips
    // BAD_INPUT, which was too aggressive and blocked confirm:true+phone:false.)
    const { requests } = baseFlow({ withCredits: true });
    const elicit = vi.fn(async () => ({ action: "decline" as const }));
    const ctx: ToolContext = { bulkTracker: new InMemoryBulkStore(), elicit };

    const res: any = await enrichTitles.execute(
      newClient(),
      { leadIds: [LEAD_A], lensId: LENS_ID, titles: [TITLE], phone: false },
      ctx
    );

    expect(res.mode).toBe("needs_confirmation");
    expect(res.would_launch).toEqual({ titles: [TITLE], email: true, phone: false });
    expect(launchCalls(requests)).toHaveLength(0);
  });

  it("confirm:true + phone:false launches the approved default email spend (Codex P2 round-4)", async () => {
    // The regression: {titles, confirm:true, phone:false} must launch the email
    // spend the user approved — a disabled phone flag must not suppress the
    // default email channel or trip BAD_INPUT. This is the documented confirm
    // retry shape (agents add confirm:true and carry phone:false along).
    const { requests } = baseFlow({ withLaunch: true });
    const ctx: ToolContext = { bulkTracker: new InMemoryBulkStore() };

    const res: any = await enrichTitles.execute(
      newClient(),
      { leadIds: [LEAD_A], lensId: LENS_ID, titles: [TITLE], confirm: true, phone: false },
      ctx
    );

    expect(res.mode).toBe("launched");
    expect(res.email).toBe(true);
    expect(res.phone).toBe(false);
    expect(launchCalls(requests)).toHaveLength(1);
    const launchReq = requests.find((r) => /\/enrichment\/launch/.test(r.path));
    expect(JSON.parse(launchReq!.body ?? "{}")).toMatchObject({ email: true, phone: false });
  });

  it("phone:true with email unset launches phone ONLY — no silent email reveal (Codex P1)", async () => {
    // The core Codex finding: a phone-only request must not also post email.
    // With the channel-default fix, email stays OFF (not defaulted true) when a
    // channel was explicitly chosen, so the launch body is phone-only.
    const { requests } = baseFlow({ withLaunch: true });
    const ctx: ToolContext = { bulkTracker: new InMemoryBulkStore() };

    const res: any = await enrichTitles.execute(
      newClient(),
      { leadIds: [LEAD_A], lensId: LENS_ID, titles: [TITLE], phone: true },
      ctx
    );

    expect(res.mode).toBe("launched");
    expect(res.email).toBe(false); // NOT silently enabled
    expect(res.phone).toBe(true);
    expect(launchCalls(requests)).toHaveLength(1);
    // Prove the launch body carried email:false, not a hidden email reveal.
    const launchReq = requests.find((r) => /\/enrichment\/launch/.test(r.path));
    expect(JSON.parse(launchReq!.body ?? "{}")).toMatchObject({ email: false, phone: true });
  });

  it("email:false + phone:true IS consent (an enabled channel) → launches without eliciting", async () => {
    // The inverse guard: explicitly disabling email while enabling phone is a
    // real channel choice — phone:true counts as consent even though email is
    // off. Proves the fix keys on ENABLED channels, not merely present keys.
    const { requests } = baseFlow({ withLaunch: true });
    const elicit = vi.fn(async () => ({ action: "decline" as const }));
    const ctx: ToolContext = {
      bulkTracker: new InMemoryBulkStore(),
      elicit,
    };

    const res: any = await enrichTitles.execute(
      newClient(),
      { leadIds: [LEAD_A], lensId: LENS_ID, titles: [TITLE], email: false, phone: true },
      ctx
    );

    expect(res.mode).toBe("launched");
    expect(res.email).toBe(false);
    expect(res.phone).toBe(true);
    expect(elicit).not.toHaveBeenCalled();
    expect(launchCalls(requests)).toHaveLength(1);
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
    // Not consented → elicits (reads credits) → accepts → launches.
    const { requests } = baseFlow({ withCredits: true, withLaunch: true });
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

  it("explicit confirm:false + NO elicit → withholds, does not launch (Codex P2)", async () => {
    // A direct/core/legacy caller (no ctx.elicit) that passes confirm:false is
    // declining the spend. Previously willElicit was false so it launched
    // anyway; now the veto returns needs_confirmation with no /launch.
    const { requests } = baseFlow({ withCredits: true });
    const ctx: ToolContext = { bulkTracker: new InMemoryBulkStore() }; // no elicit

    const res: any = await enrichTitles.execute(
      newClient(),
      { leadIds: [LEAD_A], lensId: LENS_ID, titles: [TITLE], confirm: false },
      ctx
    );

    expect(res.mode).toBe("needs_confirmation");
    expect(res.launched).toBe(false);
    expect(launchCalls(requests)).toHaveLength(0);
  });

  it("confirm:false VETOES even an explicit channel → withholds", async () => {
    // A veto wins over an explicit channel flag: the caller said "don't spend".
    const { requests } = baseFlow({ withCredits: true });
    const ctx: ToolContext = { bulkTracker: new InMemoryBulkStore() };

    const res: any = await enrichTitles.execute(
      newClient(),
      { leadIds: [LEAD_A], lensId: LENS_ID, titles: [TITLE], email: true, confirm: false },
      ctx
    );

    expect(res.mode).toBe("needs_confirmation");
    expect(launchCalls(requests)).toHaveLength(0);
  });

  it("confirm:false + elicit present → withholds directly, does NOT prompt", async () => {
    // Veto short-circuits before elicitation — no point asking a user who
    // already declined via the arg.
    const { requests } = baseFlow({ withCredits: true });
    const elicit = vi.fn(async () => ({ action: "accept" as const, content: { confirm: true } }));
    const ctx: ToolContext = { bulkTracker: new InMemoryBulkStore(), elicit };

    const res: any = await enrichTitles.execute(
      newClient(),
      { leadIds: [LEAD_A], lensId: LENS_ID, titles: [TITLE], confirm: false },
      ctx
    );

    expect(res.mode).toBe("needs_confirmation");
    expect(elicit).not.toHaveBeenCalled();
    expect(launchCalls(requests)).toHaveLength(0);
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

  it("selection lock is NOT held during elicitation (product#3848 concurrency)", async () => {
    // The lock is a boolean + wait-queue. If phase 1 still held it while we
    // await the user, this acquire would deadlock: phase 1 can't release until
    // elicit returns, and elicit can't return until acquire resolves. So the
    // acquire succeeding INSIDE the elicit handler — and the whole call
    // completing without timing out — is the proof the lock was released.
    const { requests } = baseFlow({ withCredits: true, withLaunch: true });
    const client = newClient();
    let lockWasFreeDuringElicit = false;

    const ctx: ToolContext = {
      bulkTracker: new InMemoryBulkStore(),
      elicit: async () => {
        // Would hang forever if the lock were still held by phase 1.
        await client.acquireSelectionLock();
        lockWasFreeDuringElicit = true;
        client.releaseSelectionLock();
        return { action: "accept" as const, content: { confirm: true } };
      },
    };

    const res: any = await enrichTitles.execute(
      client,
      { leadIds: [LEAD_A], lensId: LENS_ID, titles: [TITLE] },
      ctx
    );

    expect(lockWasFreeDuringElicit).toBe(true);
    expect(res.mode).toBe("launched");
    expect(launchCalls(requests)).toHaveLength(1);
  });
});
