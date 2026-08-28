/**
 * The runtime recovery only fires when the agent SENDS a country. The
 * descriptions tell it not to — so the rules have to live there too.
 *
 * This is the gap a whole review round was spent on. Every fix to the
 * `COUNTRY_LEVEL_LOCATION` envelope — inherited lens geography, the persisted
 * Monitor filter, the taxonomy-lookup override — is reachable only on the
 * REJECTION path. But the shared rule instructs the agent to recognise a
 * whole-country ask and omit the geo argument BEFORE calling, which is the
 * normal path and the one a well-behaved agent takes. On that path the guard
 * never fires and the envelope is never seen:
 *
 *   "make this healthcare nationwide" → adjust_audience({sectors:["Healthcare"]})
 *
 * carries no country at all, merges into a Paris-scoped lens, and returns Paris
 * healthcare with nothing anywhere having said otherwise.
 *
 * So each rule is pinned on the SURFACE the agent reads before it calls.
 */
import { describe, it, expect } from "vitest";

import * as Generated from "@leadbay/core/dist/tool-descriptions.generated.js";
import * as Prompts from "../../src/prompts.generated.js";

const desc = (name: string) => (Generated as unknown as Record<string, string>)[name];

describe("audit: pre-call country rules live in the descriptions", () => {
  it("pull_followups says a whole-workspace read also needs filtered:false", () => {
    const body = desc("leadbay_pull_followups");
    expect(body, "leadbay_pull_followups description not found").toBeTruthy();
    expect(
      body,
      "omitting `city` does not widen this tool — `filtered` defaults to true and a persisted filter still applies"
    ).toMatch(/filtered:false/);
    // …and it must NOT stop there: with other criteria requested, filtered:false
    // discards them, so the re-send route has to be named in the same breath.
    expect(body).toMatch(/re-send them in `set_filter`/);
  });

  it("the followup_check_in prompt carries the same rule", () => {
    // The description is what a tool-calling agent reads; the prompt is what an
    // orchestrated session reads. The failure is reachable from both.
    const body = Prompts.leadbay_followup_check_in;
    expect(body).toMatch(/filtered:false/);
    expect(body).toMatch(/active_filters/);
  });

  it.each(["leadbay_adjust_audience", "leadbay_new_lens"])(
    "%s warns that existing lens geography survives",
    (name) => {
      const body = desc(name);
      expect(body, `${name} description not found`).toBeTruthy();
      // The resource that can actually answer it, named on the surface that
      // sends the agent looking.
      expect(
        body,
        `${name} must point at the only place a lens's location_ids are readable`
      ).toMatch(/lens:\/\//);
      expect(
        body,
        `${name} must say that omitting locations is not the same as having none`
      ).toMatch(/(MERGE|inherits)/i);
    }
  );

  it("adjust_audience names the merge specifically", () => {
    // new_lens inherits via cloning, adjust_audience via merging. Different
    // mechanisms, and an agent needs the one that applies to the call it makes.
    expect(desc("leadbay_adjust_audience")).toMatch(/Location criteria MERGE/i);
    expect(desc("leadbay_new_lens")).toMatch(/CLONE/);
  });

  it("list_locations overrides the omit-and-claim-coverage recovery", () => {
    const body = desc("leadbay_list_locations");
    expect(
      body,
      "`q` is required here and an empty lookup is not workspace-wide coverage"
    ).toMatch(/does NOT apply to this tool/i);
    expect(body).toMatch(/REQUIRED/);
  });

  it("the tour keeps its own override — this audit must not have loosened it", () => {
    // tour_plan was the first tool to override the shared recovery. Re-pinned
    // here so a later pass cannot quietly fold it back into the generic rule.
    expect(desc("leadbay_tour_plan")).toMatch(/do NOT omit/i);
  });
});
