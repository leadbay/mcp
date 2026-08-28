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
    // The chain must span both list payloads: pull_leads has short_description
    // but no sector_id; pull_followups has sector_id but no short_description.
    for (const step of [
      "short_description",
      "`description`",
      "tags[].display_name",
      "qualification_summary.best_response_excerpt",
      "`keywords`",
    ]) {
      expect(GUIDE).toContain(step);
    }
    expect(GUIDE).toMatch(/complementary/i);
    // A per-row research call to fill one line is a request per lead.
    // Prose wraps, so match against whitespace-collapsed text.
    expect(GUIDE.replace(/\s+/g, " ")).toMatch(
      /Never call `research_lead_by_id` per row/i,
    );
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

  it("gives the real Leadbay deep-link for an Open-in-app affordance", () => {
    // ?lead=<uuid> is LEAD_QUERY_PARAM in the web app, read on load.
    expect(GUIDE).toContain("?lead=");
    expect(GUIDE).toContain("encodeURIComponent(lead.id)");
    // lead.id is otherwise on the hide-list — this is the single exception.
    expect(GUIDE.replace(/\s+/g, " ")).toMatch(
      /ONE place a card may use `lead.id`: as a link target, never as visible text/i,
    );
  });

  it("keeps the link's text as its accessible name, arrow decorative", () => {
    // Text carries the meaning, so the svg must not be announced as well.
    expect(GUIDE).toContain("Open in Leadbay");
    expect(GUIDE).toContain('aria-hidden="true"');
    // A plain diagonal arrow, not the box-with-arrow glyph.
    expect(GUIDE).toContain('<line x1="7" y1="17" x2="17" y2="7"/>');
    expect(GUIDE.replace(/\s+/g, " ")).toMatch(/bare diagonal stroke/i);
  });

  it("selects the view the lead lives in, not always /discover", () => {
    // Every pull_followups lead carries in_monitor:true — linking those to
    // /app/discover lands the rep in a list that does not contain the lead.
    for (const view of ["monitor", "discover", "campaign"]) {
      expect(GUIDE).toContain(view);
    }
    expect(GUIDE).toContain("lead.in_monitor");
    expect(GUIDE).toContain("/app/${view}?lead=");
    // pull_leads omits both flags, so the default must be stated.
    expect(GUIDE.replace(/\s+/g, " ")).toMatch(/omits both flags/i);
  });

  it("gives campaign cards BOTH params — campaign selects the list, lead the panel", () => {
    expect(GUIDE).toContain("/app/campaign?campaign=");
    expect(GUIDE).toContain("&lead=");
    expect(GUIDE).toContain("CAMPAIGN_QUERY_PARAM");
    // Dropping campaign= opens an empty campaign view, so say so.
    expect(GUIDE.replace(/\s+/g, " ")).toMatch(
      /Omitting `campaign=` opens an empty campaign view/i,
    );
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
