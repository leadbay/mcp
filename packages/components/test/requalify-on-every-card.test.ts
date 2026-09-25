import { describe, it, expect } from "vitest";
import { ARTIFACT_USAGE_GUIDE as GUIDE } from "../../core/src/artifact-runtime.generated.js";
import { STYLES } from "../src/styles.js";

// Requalify was documented twice — once as a line in the recipe's HTML
// skeleton, once as a prose note pinning its argument shape — and mandated
// nowhere. triage-board-recipe.test.ts asserted the ARG NAME (`leadIds`
// camelCase) while never asserting the button exists, so a board that omitted
// it passed every check.
//
// It got omitted. An agent building from the recipe rendered the footer with
// only the spacer and the Open-in-Leadbay link; the rep could read the
// qualifier's verdict and the intent tags but had no way to say "this is
// wrong, run it again" without leaving the artifact.
//
// The button is the one control that acts on the line the rep is doubting, so
// these pin it as a default of the board rather than an optional extra.

const flat = GUIDE.replace(/\s+/g, " ");

describe("Requalify is a default on every card, not an option", () => {
  it("is stated as carried by every card", () => {
    expect(flat).toMatch(/Every card ships Qualify\/Requalify/i);
    expect(flat).toMatch(/MANDATORY on every\s*lead card/i);
  });

  it("is explicitly NOT conditional on the lead looking under-qualified", () => {
    // The tempting reading — "show it when qualification is thin" — is what
    // turns a default into a judgement call the agent then skips.
    expect(flat).toMatch(/not conditional on the lead looking\s*under-qualified/i);
  });

  it("is named in the recipe's wiring sentence, beside the other writes", () => {
    // Living only in the HTML skeleton is what made it droppable.
    expect(flat).toMatch(/plus `lb\.qualify` in `lb-card-foot`/i);
  });

  it("routes through the component, never a hand-rolled lb.action", () => {
    // The hand-rolled version is what this guide used to teach, and it gets
    // the camelCase arg, the failed[] check and quota_exceeded wrong.
    expect(flat).toMatch(/Use `lb\.qualify` — never hand-roll this action/i);
    expect(GUIDE).not.toContain('tool: "leadbay_bulk_qualify_leads"');
  });

  it("sits in the card footer, not among the taste and status writes", () => {
    expect(GUIDE).toContain("lb-card-foot");
    expect(flat).toMatch(/sits in `lb-card-foot` next to\s*Open in Leadbay/i);
  });

  it("ships a wiring example, so the button is copyable and not just described", () => {
    expect(GUIDE).toContain("lb.qualify({ leadId: lead.id");
    expect(GUIDE).toContain("lb.bindAction(els.qualify, q)");
    expect(GUIDE).toContain("lb.qualifyLabel(lead)");
  });

  it("makes the label a function of the lead, not a hardcoded word", () => {
    // "Requalify" on an unscored lead implies a run that never happened.
    expect(flat).toMatch(/Which word the button takes is not a style choice/i);
    expect(flat).toMatch(/has never been run and gets \*\*Qualify\*\*/i);
  });

  it("names both tools the artifact must declare", () => {
    expect(flat).toMatch(/Declare BOTH tools in the artifact's `mcp_tools`/i);
    expect(GUIDE).toContain("leadbay_qualify_status");
  });

  it("tells the card to report a QUEUED job, not a fresh verdict", () => {
    // wait_for_completion:false returns on queue. A card that repaints as
    // though the verdict refreshed lies about work that has not run yet.
    expect(flat).toMatch(/QUEUED, not finished/i);
    expect(flat).toMatch(/leave the old tags alone/i);
    // and the way to actually show it landing
    expect(GUIDE).toContain("lb.qualifyStatus");
  });

  it("rides the cold-call sheet's rows too, not just the batch board", () => {
    // A rep on the phone is the likeliest person to find the verdict wrong.
    const sheet = GUIDE.slice(
      GUIDE.indexOf("## Recipe: cold-call sheet"),
      GUIDE.indexOf("## Recipe: lead-status dropdown"),
    );
    expect(sheet).toContain("lb.qualify(");
    expect(sheet).toContain("lb.qualifyLabel(lead)");
  });

  it("carries the product's AI affordance, matching the app's QualifyButton", () => {
    expect(GUIDE).toContain("lb-btn-ai");
    // and the skin actually implements that variant
    expect(STYLES).toMatch(/\.lb-btn-ai\{background-color:var\(--color-purple-background\)/);
  });
});
