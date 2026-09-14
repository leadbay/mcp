/**
 * Audit: a delivered-but-disqualified item is not rendered as a prospect.
 *
 * leadbay_qualify_leads deliberately DELIVERS org-owned companies that failed
 * qualification, carrying their negative evidence ("here's why to skip this
 * account" is a deliverable). splitItems therefore places them in `leads[]`,
 * where the shared delivery recipe renders a fit bar and a "Why it fits"
 * column — so a rejected account could be presented as a positive prospect,
 * with a high firmographic score, on a PAID result.
 *
 * The rule belongs only to the tools that can actually emit such an item:
 * qualify_leads, and lead_job_status when polling a qualify job. find_new_leads
 * filters disqualified candidates out via min_ai_score and never delivers one,
 * so it must NOT pay the char budget for a rule it cannot hit.
 */

import { describe, it, expect } from "vitest";
import * as Generated from "@leadbay/core/dist/tool-descriptions.generated.js";

const G = Generated as unknown as Record<string, string>;
const EMITTERS = ["leadbay_qualify_leads", "leadbay_lead_job_status"];

describe("audit: delivered-but-disqualified rendering", () => {
  it("both emitting tools carry the branch", () => {
    for (const tool of EMITTERS) {
      expect(G[tool], `${tool} missing the rule`).toMatch(/Delivered ≠ endorsed/);
    }
  });

  it("the branch names the fields the agent can actually test", () => {
    for (const tool of EMITTERS) {
      expect(G[tool]).toContain("status_reason");
      expect(G[tool]).toMatch(/ai_score/);
    }
  });

  it("it gives them a section of their own, not the fit table", () => {
    for (const tool of EMITTERS) {
      // Whitespace-tolerant: the snippet is hard-wrapped, so the label can
      // legitimately break across a line.
      expect(G[tool]).toMatch(/Evaluated\s+—\s+does not fit/);
    }
  });

  it("find_new_leads does not carry it — it cannot deliver one", () => {
    // Guards the scoping decision: this tool is the budget-critical one, and
    // adding a rule it can never hit is how its headroom evaporates.
    expect(G.leadbay_find_new_leads).not.toMatch(/Delivered ≠ endorsed/);
  });
});
