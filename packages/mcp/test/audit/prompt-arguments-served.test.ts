/**
 * `prompts/list` must serve the argument descriptions the templates declare.
 *
 * The server's CATALOG (packages/mcp/src/prompts.ts) used to hand-copy every
 * argument description. Seven of them had drifted from their `.md.tmpl`
 * frontmatter by the time this file was written — including `city`,
 * `territory`, `audience` and `rep_split`, the four that carry the
 * single-country warning (product#3951).
 *
 * That drift is invisible in the worst possible way. The single-country audit
 * asserts `PROMPT_META.<prompt>.arguments`, which is the GENERATED text, and it
 * passed — while a client calling `prompts/list` received the stale hand-written
 * copy with no warning in it. An audit proving a guard exists somewhere it is
 * never delivered is worse than no audit: it retires the question.
 *
 * So this file asserts the two agree, on the served surface, for every prompt
 * and every argument — not just the ones that happen to matter today.
 */
import { describe, it, expect } from "vitest";

import { PROMPT_META } from "../../src/prompts.generated.js";
import { listPrompts } from "../../src/prompts.js";

const SERVED = listPrompts();

describe("prompts/list serves the generated argument metadata", () => {
  it.each(SERVED.map((p) => p.name))("%s arguments match PROMPT_META exactly", (name) => {
    const served = SERVED.find((p) => p.name === name);
    const meta = (PROMPT_META as Record<string, { arguments?: unknown[] }>)[name];
    expect(meta, `${name} is served by prompts/list but absent from PROMPT_META`).toBeTruthy();

    // Compared as plain data so a reordering or a single edited word fails.
    expect(
      JSON.parse(JSON.stringify(served?.arguments ?? [])),
      `${name}: prompts/list arguments differ from the generated frontmatter. Edit the .md.tmpl — the catalog must not hand-copy descriptions.`
    ).toEqual(JSON.parse(JSON.stringify(meta?.arguments ?? [])));
  });
});

/**
 * The four free-text arguments a user can phrase as a whole country. Each one
 * reaches the agent through `prompts/list` BEFORE any prompt body is fetched,
 * so the warning has to survive on that surface specifically.
 */
const COUNTRY_BEARING_ARGUMENTS: ReadonlyArray<[string, string]> = [
  ["leadbay_plan_tour_in_city", "city"],
  ["leadbay_top_accounts_to_activate", "territory"],
  ["leadbay_setup_team_prospecting", "audience"],
  ["leadbay_setup_team_prospecting", "rep_split"],
];

describe("the single-country warning survives to the served surface", () => {
  it.each(COUNTRY_BEARING_ARGUMENTS)(
    "%s.%s tells the agent a country is not a place",
    (promptName, argName) => {
      const served = SERVED.find((p) => p.name === promptName);
      expect(served, `${promptName} is not registered in the server CATALOG`).toBeTruthy();

      const description = served?.arguments?.find((a) => a.name === argName)?.description;
      expect(
        description,
        `${promptName} does not expose a "${argName}" argument through prompts/list`
      ).toBeTruthy();

      // Not a fixed sentence — the wording differs per argument by design. What
      // must hold is that the country is named as NOT a location value.
      expect(
        description,
        `${promptName}.${argName} must say a country is not a usable scope here (product#3951)`
      ).toMatch(/countr(y|ies)/i);
    }
  );

  it("the tour's city argument keeps its ask-do-not-omit exception", () => {
    // tour_plan is the one geo tool whose recovery is NOT "omit the argument":
    // a city-less tour is arbitrary whole-workspace leads presented as an
    // itinerary. Pinned on the SERVED surface, not just the generated one.
    const city = SERVED.find((p) => p.name === "leadbay_plan_tour_in_city")
      ?.arguments?.find((a) => a.name === "city")?.description;
    expect(city).toMatch(/do NOT omit/i);
    expect(city).not.toMatch(/means NO geo filter/i);
  });
});
