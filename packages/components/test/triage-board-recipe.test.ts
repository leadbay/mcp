import { describe, it, expect } from "vitest";
import { ARTIFACT_USAGE_GUIDE as GUIDE } from "../../core/src/artifact-runtime.generated.js";

// `leadbay_pull_leads`' NEXT STEPS offers "Build an interactive lead triage
// board" as its FIRST option, and WORKFLOWS.md asserts that ordering. What the
// agent then builds was unspecified, so every board came out different — one
// had like/dislike and no status, the next status and no taste, a third
// neither. This pins the canonical recipe so the offer resolves to ONE board.
//
// Read through the GENERATED module, as card-contract.test.ts does: that is the
// string the agent actually receives, so a stale build fails here too.

describe("canonical pull-leads triage board recipe", () => {
  it("declares the recipe section", () => {
    expect(GUIDE).toContain("## Recipe: the pull-leads triage board");
  });

  it("is stated as fixed, not as a starting point", () => {
    const flat = GUIDE.replace(/\s+/g, " ");
    expect(flat).toMatch(/fixed recipe, not a starting point/i);
  });

  it("builds from data in hand rather than re-calling the source tool", () => {
    // Generalised when the board became the offer on every batch tool, not
    // just pull_leads — see board-offered-on-every-batch.test.ts.
    const flat = GUIDE.replace(/\s+/g, " ");
    expect(flat).toMatch(/never re-call the tool that produced\s*the batch/i);
  });

  it("names every default control", () => {
    for (const control of [
      "lb.like",
      "lb.dislike",
      "lb.setStatus",
      "lb.outreach",
      "lb.leadStatus()",
      "lb.sortOrder()",
      "Open in Leadbay",
    ]) {
      expect(GUIDE).toContain(control);
    }
  });

  it("lists the four filters", () => {
    const flat = GUIDE.replace(/\s+/g, " ");
    expect(flat).toMatch(/CRM status · taste · qualifier verdict · sector/);
  });

  it("keeps filters client-side and sorting server-side", () => {
    const flat = GUIDE.replace(/\s+/g, " ");
    expect(flat).toMatch(/Filters are CLIENT-side/);
    expect(flat).toMatch(/sort is SERVER-side/);
    expect(flat).toContain("loadPage(0)");
  });

  // The whole point of the "be lazy" decision: a 20-lead board must not fire
  // 20 research calls to fill lines the rep may never read. This mirrors the
  // card contract's existing "Never call research_lead_by_id per row" rule.
  it("requires rich profile data to load lazily, on expand", () => {
    const flat = GUIDE.replace(/\s+/g, " ");
    expect(flat).toMatch(/Rich profile data is LAZY/i);
    expect(GUIDE).toContain("lb.leadProfile");
    expect(flat).toMatch(/only when the rep EXPANDS that card/i);
    expect(flat).toMatch(/Never prefetch it for the batch/i);
  });

  it("pins the requalify argument name, which is camelCase", () => {
    const flat = GUIDE.replace(/\s+/g, " ");
    expect(GUIDE).toContain("leadbay_bulk_qualify_leads");
    // `lead_ids` would be silently rejected by the tool's schema.
    expect(flat).toMatch(/`leadIds` \(camelCase — NOT\s+`lead_ids`\)/);
    expect(GUIDE).toContain("wait_for_completion: false");
  });
});
