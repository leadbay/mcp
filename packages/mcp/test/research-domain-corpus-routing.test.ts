import { describe, expect, it } from "vitest";
import { leadbay_research_a_domain } from "../src/prompts.generated.js";

describe("research-a-domain corpus routing", () => {
  it("searches visible Leadbay leads before offering an import", () => {
    const searchAt = leadbay_research_a_domain.indexOf(
      "leadbay_research_lead_by_name_fuzzy"
    );
    const importAt = leadbay_research_a_domain.indexOf(
      "leadbay_import_and_qualify"
    );

    expect(searchAt).toBeGreaterThanOrEqual(0);
    expect(importAt).toBeGreaterThan(searchAt);
    expect(leadbay_research_a_domain).toContain(
      "Do NOT call `leadbay_import_and_qualify` automatically"
    );
    expect(leadbay_research_a_domain).toContain(
      "Discover, Monitor, and Activate corpus"
    );
  });
});
