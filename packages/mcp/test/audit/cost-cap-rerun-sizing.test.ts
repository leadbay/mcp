/**
 * Audit: the max_cost rerun is sized to the shortfall, not the original ask.
 *
 * A search that stops at its cost cap has delivered PART of the batch. Telling
 * the agent only to "raise the cap and continue" makes it re-request the FULL
 * original count — a 10-lead ask that delivered 6 asks for 10 more, not 4 —
 * and, because `novelty: org` excludes only DELIVERED leads, the rerun also
 * pays to re-examine the same examined-and-rejected candidates. Both overspend
 * while the action is presented to the user as a continuation.
 */

import { describe, it, expect } from "vitest";
import * as Generated from "@leadbay/core/dist/tool-descriptions.generated.js";

const G = Generated as unknown as Record<string, string>;
const D = G.leadbay_find_new_leads;

// The rerun row, isolated so these assertions cannot be satisfied by wording
// that happens to appear elsewhere in a 16k description.
const ROW = D.split("\n").find((l) => l.includes("stop_reason: max_cost")) ?? "";

describe("audit: max_cost rerun sizing", () => {
  it("has a rerun row to govern", () => {
    expect(ROW, "max_cost NEXT STEPS row missing").not.toBe("");
  });

  it("sizes the rerun to the remaining gap, not the original count", () => {
    expect(ROW).toMatch(/SHORTFALL/);
    expect(ROW).toMatch(/items_requested/);
  });

  it("carries the examined-but-rejected ids so the rerun does not re-buy them", () => {
    expect(ROW).toMatch(/exclude_lead_ids/);
    // Naming WHY: novelty covers delivered leads, so exclusions are the only
    // thing that covers the paid misses.
    expect(ROW).toMatch(/novelty covers delivered/i);
  });

  it("still requires a new request_id — a same-id resubmit only dedupes onto a live job", () => {
    expect(ROW).toMatch(/NEW request_id/);
  });

  it("keeps the tool within its description budget", () => {
    expect(D.length).toBeLessThanOrEqual(17000);
  });
});
