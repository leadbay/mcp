import { describe, it, expect } from "vitest";
import { ARTIFACT_USAGE_GUIDE as GUIDE } from "../../core/src/artifact-runtime.generated.js";

// The org-wide status select SAVES ON CHANGE — one interaction, no second
// button — matching the web app's own status selector. The guide carried that
// rule in its lead-status section while three other passages (the control
// grouping advice, the icon-button caveat, and the triage-board recipe table)
// still told the agent to render a "Set status" submit beside the select.
// An agent reading top-to-bottom hit the button instruction first and built it.
//
// These pin the single answer so the contradiction cannot return.

const flat = GUIDE.replace(/\s+/g, " ");

describe("status saves on change, with no submit button", () => {
  it("states the rule", () => {
    expect(flat).toMatch(/Save on change is the default for status/i);
    expect(flat).toMatch(/one interaction, no second button/i);
  });

  it("shows the change-event wiring rather than bindAction", () => {
    expect(flat).toMatch(/addEventListener\("change", \(\) => save\.run\(\)\)/);
    expect(flat).toMatch(/Drop `?bindAction`?/i);
  });

  it("requires the select to show the write, since it is the only affordance", () => {
    expect(flat).toMatch(/the select IS the feedback surface/i);
    expect(flat).toMatch(/mirror `?data-lb-state`? onto it/i);
    expect(flat).toMatch(/A silent select leaves the rep unsure/i);
  });

  it("the triage-board recipe does NOT prescribe a Set status button", () => {
    // The recipe's Status section is what an agent copies; it holds the select
    // and nothing else. A submit beside it would reintroduce the second step.
    const section = flat.match(/lb-sec-title">Status<\/div>.*?<\/div>/)?.[0] ?? "";
    expect(section).toContain("lb-select");
    expect(section).not.toMatch(/Set status/i);
    expect(section).not.toMatch(/lb-btn-submit/);
    // The only submit on the card belongs to the Outreach section's note.
    expect(flat).toMatch(/lb-btn lb-btn-submit">Log outreach/);
  });

  it("keeps lb-btn-submit only for writes that genuinely need a second step", () => {
    expect(flat).toMatch(
      /Reserve `?lb-btn-submit`? for a write that really does need a second step/i,
    );
    // Bulk apply is the sanctioned exception — it fans out and takes a confirm.
    expect(flat).toMatch(/bulk apply/i);
  });

  it("the copyable lead-status example wires change, not a button", () => {
    // This snippet is the first thing an agent copies. It previously showed
    // `<button id="go">Apply</button>` + bindAction, which is what produced the
    // extra button even though the rule below it said otherwise.
    expect(flat).not.toMatch(/<button id="go"/);
    expect(flat).not.toMatch(/lb\.bindAction\(document\.getElementById\("go"\)/);
    expect(flat).toMatch(/sel\.addEventListener\("change", \(\) => save\.run\(\)\);\s*\/\/ change → write, no button/);
    expect(flat).toMatch(/as a `?<select>`? that writes on change — no Apply\s*button/i);
  });

  it("no passage still tells the agent to commit status with a button", () => {
    // The old wording — "mark the commit with lb-btn-submit" next to the status
    // select — is what produced the extra button. It must be gone.
    expect(flat).not.toMatch(/"Set status" commits the select beside it/i);
    expect(flat).not.toMatch(/and mark the commit with `?lb-btn-submit`?/i);
  });
});
