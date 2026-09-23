/**
 * The elicitation paragraph names the tools that can raise an elicitation, and
 * it picks them by matching a label prefix against the exposed tool set.
 *
 * `leadbay_refine_prompt` became `leadbay_refine_lead_targeting` in 0.40.0.
 * The filter was updated; the label string it matches against was not, so the
 * entry silently vanished from the system prompt even with the tool exposed.
 * A string on one side of a `startsWith` and a rename on the other is exactly
 * the drift no type checks, so it gets a test.
 */
import { describe, it, expect } from "vitest";
import { buildServerInstructions } from "../../src/server.js";

const READS = ["leadbay_account_status", "leadbay_pull_leads"];

describe("elicitation paragraph after the refine_prompt rename", () => {
  it("names refine_lead_targeting when the tool is exposed", () => {
    const out = buildServerInstructions(
      new Set([...READS, "leadbay_refine_lead_targeting"]),
    );
    expect(out).toMatch(/refine_lead_targeting clarifications/);
  });

  it("drops it when the tool is not exposed", () => {
    const out = buildServerInstructions(new Set(READS));
    expect(out).not.toMatch(/refine_lead_targeting clarifications/);
  });

  it("never names the retired identifier", () => {
    const out = buildServerInstructions(
      new Set([...READS, "leadbay_refine_lead_targeting", "leadbay_report_outreach"]),
    );
    expect(out).not.toMatch(/refine_prompt/);
  });
});
