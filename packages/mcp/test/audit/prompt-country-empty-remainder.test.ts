/**
 * A prompt gate that STRIPS a country must handle stripping to nothing.
 *
 * The strip-don't-stop rule exists because "hospitals running their own IT
 * nationwide" is a refinement about hospitals, and killing the run over the
 * redundant country threw away the request. But the rule has an edge it did not
 * cover: when the country IS the whole argument, the sanitized text is empty —
 * and "drop it and continue" then walks into the mutation this ticket forbids.
 *
 * On `leadbay_setup_team_prospecting` that path is concrete and expensive:
 * `refine_prompt({user_prompt: ""})` overwrites the user's refinement prompt
 * with nothing, and `create_lens` + `promote_lens` then persist AND ACTIVATE a
 * scopeless lens, to express a scope the workspace already has.
 *
 * `leadbay_refine_audience` already handles this ("Nothing remains → STOP
 * HERE"); both are pinned here so neither loses it to a wording pass.
 */
import { describe, it, expect } from "vitest";

import * as Prompts from "../../src/prompts.generated.js";

const PROMPTS_THAT_STRIP = ["leadbay_refine_audience", "leadbay_setup_team_prospecting"] as const;

describe("audit: stripping the country to nothing is a stop, not a continue", () => {
  it.each(PROMPTS_THAT_STRIP)("%s stops when nothing survives the strip", (name) => {
    const body = (Prompts as Record<string, string>)[name];
    expect(body, `${name} is missing from prompts.generated.ts`).toBeTruthy();

    // It must consider the empty-remainder case at all…
    expect(
      body,
      `${name} tells the agent to strip the home country; it must also say what happens when that leaves nothing`
    ).toMatch(/leaves? NOTHING|Nothing remains/i);

    // …and the answer must be to write nothing, not to carry on.
    expect(
      body,
      `${name} must forbid the write when the country was the entire input`
    ).toMatch(/(STOP HERE|Write nothing at all|Call\s+NOTHING)/i);
  });

  it("setup_team_prospecting names the specific calls it must not make", () => {
    // A generic "stop" is easy to talk past. Naming the three calls that would
    // fire is what makes the instruction checkable by the agent reading it.
    const body = Prompts.leadbay_setup_team_prospecting;
    expect(body).toMatch(/leadbay_refine_prompt\(\{user_prompt: ""\}\)/);
    expect(body).toMatch(/leadbay_create_lens/);
    expect(body).toMatch(/leadbay_promote_lens/);
    // And it must say what to ask for instead of just refusing.
    expect(body).toMatch(/sector, size, or sub-country criterion/i);
  });

  it("the rep_split argument gets the same treatment", () => {
    // rep_split is the second free-text ingress and reaches PHASE 3 campaigns.
    expect(Prompts.leadbay_setup_team_prospecting).toMatch(
      /sanitized split is empty, there is no split to make/i
    );
  });
});
