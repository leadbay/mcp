/**
 * Audit: the delivery NEXT STEPS tables offer a valid action for every state
 * the tools can actually return.
 *
 * These tables are normative — the agent is told to pick a row and offer it.
 * A state with no matching row leaves the agent instructed to offer something
 * while holding nothing valid to offer, which is how a terminal `expired` job
 * ended up rendered as an empty delivery.
 *
 * Read from the GENERATED descriptions, not the snippets, so a template that
 * stops being included is caught too.
 */

import { describe, it, expect } from "vitest";
import {
  leadbay_find_new_leads,
  leadbay_lead_job_status,
} from "@leadbay/core/dist/tool-descriptions.generated.js";

describe("audit: find_new_leads NEXT STEPS", () => {
  it("separates the cost-cap stop from the org-quota stop", () => {
    // Raising max_cost cannot clear an org quota: re-running burns a submit
    // and a rate-limit slot to stop in the same place.
    expect(leadbay_find_new_leads).toMatch(/stop_reason: max_cost/);
    expect(leadbay_find_new_leads).toMatch(/stop_reason: quota/);
  });

  it("routes a quota stop at quota recovery, not another search", () => {
    const row = leadbay_find_new_leads
      .split("\n")
      .find((l) => l.includes("stop_reason: quota"));
    expect(row, "no quota row in the NEXT STEPS table").toBeTruthy();
    expect(row).toMatch(/leadbay_(account_status|create_topup_link|open_billing_portal)/);
    expect(row).not.toMatch(/leadbay_find_new_leads/);
  });

  it("does not hard-code a dollar sign on the cap-raise amount", () => {
    const row = leadbay_find_new_leads
      .split("\n")
      .find((l) => l.includes("stop_reason: max_cost"));
    expect(row).toBeTruthy();
    expect(row).not.toMatch(/Raise the cap to \$/);
    expect(row).toMatch(/currency/i);
  });
});

describe("audit: lead_job_status NEXT STEPS", () => {
  it("covers every terminal state the tool documents", () => {
    // TERMINAL_JOB_STATES: completed, completed_partial, failed, expired.
    for (const state of ["completed", "partial", "failed", "expired"]) {
      expect(
        leadbay_lead_job_status.toLowerCase(),
        `${state} has no NEXT STEPS row`
      ).toContain(state);
    }
  });

  it("gives expired the ledger re-read, not a render", () => {
    const row = leadbay_lead_job_status
      .split("\n")
      .find((l) => l.includes("expired") && l.includes("|"));
    expect(row, "no expired row").toBeTruthy();
    expect(row).toMatch(/prior_deliveries/);
  });
});
