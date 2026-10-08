// product#4250: the max_cost description claimed the default "covers any job".
// A TIER1 plan's whole day is 4,000 spend units, so 100,000 is 25x a budget the
// tool cannot see — and LB Nova Digital's five searches on 2026-10-07 all ran
// against the plan quota, not against max_cost. The parameter may describe what
// IT bounds; it may not tell the agent an operation is affordable.
import { describe, it, expect } from "vitest";

import { findNewLeads } from "../../../src/composite/find-new-leads.js";
import { qualifyLeads } from "../../../src/composite/qualify-leads.js";

const maxCostDescription = (tool: { inputSchema: any }): string =>
  tool.inputSchema.properties.max_cost.description;

describe("max_cost description makes no affordability claim", () => {
  it("leadbay_find_new_leads — no 'covers any job'", () => {
    expect(maxCostDescription(findNewLeads)).not.toMatch(/covers any job/i);
  });

  it("leadbay_qualify_leads — no 'covers any job'", () => {
    expect(maxCostDescription(qualifyLeads)).not.toMatch(/covers any job/i);
  });

  it("leadbay_find_new_leads — names the org quota as the separate, smaller limit", () => {
    const d = maxCostDescription(findNewLeads);
    expect(d).toMatch(/quota/i);
    expect(d).toMatch(/stop_reason:\s*quota/i);
  });

  it("both still state the default and the no-money rule", () => {
    for (const tool of [findNewLeads, qualifyLeads]) {
      const d = maxCostDescription(tool);
      expect(d).toContain("100000");
      expect(d).toMatch(/never show it.*money/i);
    }
  });
});
