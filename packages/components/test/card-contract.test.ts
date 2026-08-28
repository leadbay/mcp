import { describe, it, expect } from "vitest";
import { ARTIFACT_USAGE_GUIDE as GUIDE } from "../../core/src/artifact-runtime.generated.js";

// The usage guide is the ONLY thing telling the agent what a lead card must
// contain — it ships verbatim inside leadbay_artifact_kit's response. The
// pull_leads table has a rigorous RENDERING spec in its tool description; cards
// had none, so every artifact improvised (raw score, no sector, blank
// why-it-fits). These assertions pin the contract so it cannot quietly rot.
//
// Read through the GENERATED module rather than src/usage-guide.md: that is the
// string the agent actually receives, so a stale build fails here too. (The
// jsdom test env also gives import.meta.url an http: scheme, so fileURLToPath
// on a sibling path is not available.)

describe("lead-card contract in the usage guide", () => {
  it("declares the required-content section", () => {
    expect(GUIDE).toContain("## What every lead card MUST carry");
  });

  it("names all four required lines", () => {
    for (const line of ["Company", "State chips", "Firmographics", "Why it fits"]) {
      expect(GUIDE).toContain(line);
    }
  });

  it("keeps taste and CRM status as independent axes", () => {
    expect(GUIDE).toContain("data-taste");
    expect(GUIDE).toContain("data-status");
    expect(GUIDE).toMatch(/Never collapse to one chip/i);
  });

  it("warns that sector_id is a raw id needing leadbay_list_sectors", () => {
    expect(GUIDE).toContain("leadbay_list_sectors");
    expect(GUIDE).toMatch(/RAW ID/);
    expect(GUIDE).toMatch(/Never print the raw id/i);
  });

  it("specifies the why-it-fits fallback chain and forbids a blank line", () => {
    expect(GUIDE).toContain("short_description");
    expect(GUIDE).toContain("tags[].display_name");
    // The literal wraps across a line in the guide's prose, so match it
    // whitespace-insensitively rather than asserting a contiguous string.
    expect(GUIDE.replace(/\s+/g, " ")).toContain(
      "No description yet — run qualification to generate one",
    );
    expect(GUIDE).toMatch(/Never leave this line blank/i);
  });

  it("forbids rendering the numeric score, matching the table spec", () => {
    expect(GUIDE).toMatch(/Never render the numeric `score`/);
  });

  it("carries a hide-list covering the internal fields", () => {
    for (const field of ["`id`", "`sector_id`", "`location.pos`", "`stale_at`", "`deal_insights`"]) {
      expect(GUIDE).toContain(field);
    }
  });

  it("requires at least one action, or a table instead", () => {
    expect(GUIDE).toMatch(/Minimum actions/);
    expect(GUIDE).toMatch(/render the markdown table instead/i);
  });

  it("requires the error branch to be rendered", () => {
    expect(GUIDE).toMatch(/render the `\.error` branch/i);
  });
});
