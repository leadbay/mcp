import { describe, it, expect } from "vitest";
import { ARTIFACT_USAGE_GUIDE as GUIDE } from "../../core/src/artifact-runtime.generated.js";

// The triage board is THE default board, and its card template is the markup
// an agent copies. After 0.41.0 the prose around it said "toggles + lb.note"
// while the template still drew the old outcome select and a Log outreach
// button — so a board built from the template shipped the 60-second hang the
// release removed everywhere else. Pinned here because the template, not the
// prose, is what gets copied.

const recipe = () =>
  GUIDE.slice(
    GUIDE.indexOf("## Recipe: the pull-leads triage board"),
    GUIDE.indexOf("## Recipe: the ROUTE PLANNER"),
  );

describe("the triage card template draws the web app's writes", () => {
  it("puts the prospecting toggles in the Outreach section, not an outcome select", () => {
    // The select duplicated the toggles as a second writer of one field; the
    // button stays, now saving the note.
    const r = recipe();
    expect(r).toContain("the 4 prospecting toggles, see *Writing from a page*");
    expect(r).not.toContain("Outreach result for Acme Corp");
  });

  it("saves the note through lb.note", () => {
    expect(recipe()).toContain("the note: lb.note, never lb.outreach");
  });
});

describe("the write-call rules do not read as permission for pages", () => {
  it("say a page never calls report_outreach before explaining how to hand-roll it", () => {
    const rules = GUIDE.slice(GUIDE.indexOf("## Write-call rules"), GUIDE.indexOf("## Degradation"));
    const never = rules.indexOf("A page's buttons never call");
    const handRoll = rules.indexOf("args MUST include");
    expect(never).toBeGreaterThan(-1);
    expect(never).toBeLessThan(handRoll);
  });
});
