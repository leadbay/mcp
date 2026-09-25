import { describe, it, expect } from "vitest";
import { ARTIFACT_USAGE_GUIDE as GUIDE } from "../../core/src/artifact-runtime.generated.js";

// How a page writes a note and a prospecting action — the rule every board
// shares (call sheet, lead desk, triage card, route planner).
//
// Pinned because the wrong version is the natural one to write and fails
// only once it is live: a page that logs through lb.outreach reaches
// report_outreach, which waits 60s on a confirmation prompt a page cannot
// show, then writes anyway under a "took too long" error. Reps retried and
// logged visits twice. A recipe that drifts back to lb.outreach ships that to
// every board an agent builds afterwards.

const flat = GUIDE.replace(/\s+/g, " ");

const section = () =>
  GUIDE.slice(
    GUIDE.indexOf("### Writing from a page: a note, and the prospecting actions"),
    GUIDE.indexOf("**Rendering helpers**"),
  );

describe("one shared rule for every board", () => {
  it("exists, before the recipes that point to it", () => {
    const at = GUIDE.indexOf("### Writing from a page");
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(GUIDE.indexOf("## Recipe: cold-call sheet"));
    expect(at).toBeLessThan(GUIDE.indexOf("## Recipe: the ROUTE PLANNER"));
  });

  it("writes the note with lb.note and the action with the toggle tool", () => {
    const s = section();
    expect(s).toContain("lb.note({ leadId: lead.id, note })");
    expect(s).toContain('lb.call("leadbay_set_prospecting_action"');
  });

  it("says why a page never uses lb.outreach", () => {
    expect(flat).toMatch(/A page has nowhere to show that prompt/);
    expect(flat).toMatch(/the server cannot tell a page from an agent that claims to be one/);
  });

  it("keeps lb.outreach documented as the agent's tool, flagged off-limits to pages", () => {
    expect(flat).toMatch(/`lb\.outreach\(\{leadId, ask, status\?, note\?\}\)`[^|]*\|[^|]*\|[^|]*NOT from a page's button/);
  });
});

describe("no board recipe calls lb.outreach any more", () => {
  it("has no lb.outreach( call outside the kit table's own row", () => {
    const calls = GUIDE.split("\n").filter((l) => l.includes("lb.outreach(") && !l.startsWith("| `lb.outreach("));
    expect(calls).toEqual([]);
  });

  it("the cold-call sheet wires lb.note and the toggles", () => {
    const sheet = GUIDE.slice(
      GUIDE.indexOf("## Recipe: cold-call sheet"),
      GUIDE.indexOf("## Recipe: lead-status dropdown"),
    );
    expect(sheet).toContain("lb.note({ leadId: lead.id, note })");
    expect(sheet).toContain("toggle(lead, btn.dataset.value)");
    // The snippet may name lb.outreach to say "never"; it must not call it.
    expect(sheet).not.toContain("lb.outreach(");
  });

  it("the route planner's action section names the toggle tool", () => {
    const planner = GUIDE.slice(
      GUIDE.indexOf("## Recipe: the ROUTE PLANNER"),
      GUIDE.indexOf("## Recipe: the LEAD DESK"),
    );
    expect(planner).toContain("PROSPECTING ACTION — toggles, leadbay_set_prospecting_action");
    expect(planner).toContain("LOG OUTREACH — channel + note, NO status, via lb.note");
    expect(planner).not.toMatch(/one click = one epilogue/);
  });
});

describe("the toggles match the web app", () => {
  it("are a multi-select over TODAY's list", () => {
    expect(flat).toMatch(/multi-select over `epilogue_today_statuses`/);
  });

  it("never pre-select from epilogue_status, and say why", () => {
    // A deselect leaves epilogue_status untouched, so reading it would bring a
    // removed action back on the next open.
    expect(flat).toMatch(/never from `epilogue_status`/);
    expect(flat).toMatch(/leaves `epilogue_status` where it was/);
  });

  it("show the last value as a line, not as a selection", () => {
    expect(flat).toMatch(/"Last: Still chasing · 24 Sep" line when nothing is on today/);
  });

  it("use the web app's four colours, foreground never on the label", () => {
    expect(flat).toMatch(/Still chasing blue, Meeting planned green, Could not reach yellow, Not interested red/);
    expect(flat).toMatch(/never on the label/);
  });

  it("are checkboxes, not pressed buttons", () => {
    expect(flat).toMatch(/role="checkbox"/);
  });
});
