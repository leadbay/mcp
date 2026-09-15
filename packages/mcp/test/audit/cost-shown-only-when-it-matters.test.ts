/**
 * Audit: money is shown only when it matters.
 *
 * Product decision (CTO, 2026-09-12): the subscription is meant to cover the
 * user's needs, so the agent mentions cost only when (a) the user must approve
 * a spend before it happens, (b) there is a real problem — a quota wall, a
 * spend cap that stopped a job, billing trouble — or (c) the user asks.
 *
 * The first half pins the removals: no spend in the delivery funnel line, no
 * "show refreshed quota" after an enrichment run (in the tool descriptions AND
 * in the always-on server instruction), no quota on a plain account question.
 * The second half pins what must survive: the quote before a paid run and the
 * quota-wall top-up path. The quota gauge keeps its dollar figures (#225); this
 * audit pins only WHEN it is shown.
 *
 * Read from the GENERATED descriptions, prompts and server instructions, so a
 * snippet that is re-included somewhere else is caught too.
 *
 * New file — does not modify any existing test.
 */

import { describe, it, expect } from "vitest";
import {
  leadbay_account_status,
  leadbay_bulk_enrich_status,
  leadbay_enrich_contacts,
  leadbay_enrich_titles,
  leadbay_find_new_leads,
  leadbay_lead_job_status,
  leadbay_qualify_leads,
  NO_COMMERCE_TOOL_DESCRIPTIONS,
} from "@leadbay/core/dist/tool-descriptions.generated.js";
import * as Prompts from "../../src/prompts.generated.js";
import { QUOTA_REFRESH } from "../../src/server-instructions.generated.js";

const DELIVERY_TOOLS: Record<string, string> = {
  leadbay_find_new_leads,
  leadbay_qualify_leads,
  leadbay_lead_job_status,
};

describe("removed: the always-on spend display", () => {
  it("the delivery funnel line carries counts and the stop reason, not spend", () => {
    for (const [tool, d] of Object.entries(DELIVERY_TOOLS)) {
      expect(d, `${tool} lost the funnel line`).toMatch(/The funnel line \(mandatory/);
      expect(d, `${tool} funnel line must end on the stop reason`).toMatch(
        /stopped: <stop_reason in plain words>\./
      );
      expect(d, `${tool} still prints spend in the funnel`).not.toMatch(/spent C\.CC/);
      expect(d, `${tool} still lists spend in the funnel`).not.toMatch(/stop reason\/spend/);
      expect(d, `${tool} still reads cost into the funnel`).not.toMatch(/`funnel` \+ `cost`/);
      expect(d, `${tool} still labels a skipped channel as unbilled`).not.toMatch(/not billed/);
    }
    expect(leadbay_qualify_leads).not.toMatch(/funnel \+ cost line/);
    expect(leadbay_lead_job_status).not.toMatch(/spent so far/);
    expect(Prompts.leadbay_new_leads).not.toMatch(/stop reason \/ spend/);
  });

  it("enrichment tools no longer tell the agent to show refreshed quota after a run", () => {
    for (const [tool, d] of Object.entries({ leadbay_enrich_titles, leadbay_bulk_enrich_status })) {
      expect(d, `${tool} still pushes a post-run quota refresh`).not.toMatch(/refreshed quota/i);
      expect(d, `${tool} still pushes a post-run quota refresh`).not.toMatch(
        /show where the user stands after the (spend|run)/i
      );
    }
    expect(leadbay_bulk_enrich_status).not.toMatch(/account_status refresh ONCE/);
    expect(Prompts.leadbay_build_campaign).not.toMatch(/refreshed quota/i);
    expect(leadbay_enrich_contacts).not.toMatch(/appears on the contact after enrichment/);
  });

  it("the always-on server instruction refreshes quota only when it matters", () => {
    expect(QUOTA_REFRESH).toMatch(/only when it matters/);
    expect(QUOTA_REFRESH).toMatch(/Otherwise report the result and say nothing about quota/);
    expect(QUOTA_REFRESH).not.toMatch(/so the user sees where they now stand/);
  });

  it("quota is no longer rendered on every account answer", () => {
    expect(leadbay_account_status).not.toMatch(/whenever it is readable/i);
    expect(leadbay_account_status).not.toMatch(/quota whenever readable/i);
    expect(leadbay_account_status).not.toMatch(/at the start of a session/i);
    expect(leadbay_account_status).toMatch(/Show the quota only when it matters/);
  });
});

describe("kept: every consent gate and every real-problem path", () => {
  it("delivery runs that use quota still need a quote and a go-ahead", () => {
    for (const [tool, d] of Object.entries({ leadbay_find_new_leads, leadbay_qualify_leads })) {
      expect(d, `${tool} lost the confirm gate`).toMatch(/WITHHELD unless it\s+carries\s+`confirm: true`/);
      expect(d, `${tool} lost the withheld-until-confirmed quote`).toMatch(/needs_confirmation/);
    }
    expect(leadbay_find_new_leads).toMatch(/no double launch/);
    expect(Prompts.leadbay_new_leads).toMatch(
      /Calls that use quota need `confirm: true`; without\s+it the tool withholds the submit and hands back a quote/
    );
  });

  it("the walkthrough still says the reveal uses quota before the user decides", () => {
    expect(Prompts.leadbay_getting_started).toMatch(
      /revealing the contact\s+uses a little of their plan's quota and needs their say-so/
    );
    expect(Prompts.leadbay_getting_started).toMatch(
      /revealing \*\*one contact\*\* uses a little of their plan's quota/
    );
  });

  it("the quota silence rules survive", () => {
    expect(leadbay_account_status).toMatch(/Silence gate \(check FIRST\)/);
    expect(leadbay_bulk_enrich_status).toMatch(/do NOT display it/);
    expect(leadbay_enrich_titles).toMatch(/Do NOT invent a "credits used" figure/);
  });

  it("an exhausted quota window is still reported, with the way out", () => {
    expect(leadbay_bulk_enrich_status).toMatch(/quota_hit_count/);
    expect(leadbay_bulk_enrich_status).toMatch(/skipped because the quota window was exhausted/);
    expect(leadbay_enrich_titles).toMatch(/If and only if the backend returns `quota_exceeded`/);
    expect(QUOTA_REFRESH).toMatch(/the action stopped on an exhausted window/);
    expect(QUOTA_REFRESH).toMatch(/a top-up the user confirmed landed/);
    // The top-up offer on a real wall stays on the default (commerce) surface…
    expect(leadbay_account_status).toContain("Top-ups always beat waiting");
    expect(leadbay_account_status).toContain("leadbay_create_topup_link");
    // …and is still deleted, not reworded, where selling is not allowed.
    expect(NO_COMMERCE_TOOL_DESCRIPTIONS.leadbay_account_status).not.toContain(
      "Top-ups always beat waiting"
    );
  });

  it("the delivery table still names the usage-cap and quota stops", () => {
    expect(leadbay_find_new_leads).toMatch(/`max_cost` → "hit the job's usage cap"/);
    expect(leadbay_find_new_leads).toMatch(/`quota` →\s*\n?\s*"hit an org quota"/);
  });
});
