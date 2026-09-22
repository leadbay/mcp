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
    expect(flat).toMatch(/Every card ships Requalify/i);
  });

  it("is explicitly NOT conditional on the lead looking under-qualified", () => {
    // The tempting reading — "show it when qualification is thin" — is what
    // turns a default into a judgement call the agent then skips.
    expect(flat).toMatch(/not conditional on the lead looking\s*under-qualified/i);
  });

  it("is named in the recipe's wiring sentence, beside the other writes", () => {
    // Living only in the HTML skeleton is what made it droppable.
    expect(flat).toMatch(/plus the \*\*Requalify\*\* button in `lb-card-foot`/i);
  });

  it("sits in the card footer, not among the taste and status writes", () => {
    expect(GUIDE).toContain("lb-card-foot");
    expect(flat).toMatch(/sits in `lb-card-foot` next to\s*Open in Leadbay/i);
  });

  it("ships a wiring example, so the button is copyable and not just described", () => {
    expect(GUIDE).toContain('tool: "leadbay_bulk_qualify_leads"');
    expect(GUIDE).toContain("wait_for_completion: false");
    expect(GUIDE).toContain("lb.bindAction(els.requalify, requalify)");
  });

  it("tells the card to report a QUEUED job, not a fresh verdict", () => {
    // wait_for_completion:false returns on queue. A card that repaints as
    // though the verdict refreshed lies about work that has not run yet.
    expect(flat).toMatch(/The job is QUEUED, not finished/i);
    expect(flat).toMatch(/must NOT then\s*show the old verdict as though it were refreshed/i);
  });

  it("rides the cold-call sheet's rows too, not just the batch board", () => {
    // A rep on the phone is the likeliest person to find the verdict wrong.
    const sheet = GUIDE.slice(
      GUIDE.indexOf("## Recipe: cold-call sheet"),
      GUIDE.indexOf("## Recipe: lead-status dropdown"),
    );
    expect(sheet).toContain("els.requalify");
    expect(sheet).toContain("leadbay_bulk_qualify_leads");
  });

  it("carries the product's AI affordance, matching the app's QualifyButton", () => {
    expect(GUIDE).toContain("lb-btn-ai");
    // and the skin actually implements that variant
    expect(STYLES).toMatch(/\.lb-btn-ai\{background-color:var\(--color-purple-background\)/);
  });
});
