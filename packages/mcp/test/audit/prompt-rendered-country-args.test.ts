/**
 * The single-country rule has to survive ARGUMENT SUBSTITUTION.
 *
 * `single-country-rule.test.ts` reads the prompt bodies out of
 * `prompts.generated.ts`, where an argument is still the literal placeholder
 * `{{arg:territory_block}}`. Everything a prompt says ABOUT a country therefore
 * passed the audit while the sentence actually delivered to the agent was
 * assembled later, in `prompts.ts`, from a template string the audit never saw.
 *
 * That is not hypothetical. `leadbay_top_accounts_to_activate` rendered with
 * `territory: "France"` opened with "Scope the plan to **France** — pass it as
 * `locations` on the lens", i.e. an instruction to make exactly the call the
 * rest of the prompt forbids, in the first paragraph, ~35 lines above the
 * country branch that would have corrected it (product#3951).
 *
 * So this audit renders each prompt with hostile arguments and reads what the
 * agent would actually receive.
 */
import { describe, it, expect } from "vitest";

import { getPrompt, listPrompts } from "../../src/prompts.js";

/** Values a user really types that must never become a geo filter. */
const COUNTRY_LEVEL = [
  "France",
  "United States",
  "USA",
  "the whole US",
  "EU",
  "UE",
  "Union européenne",
  "EMEA",
] as const;

/** Every prompt argument that feeds a territory / location slot. */
const GEO_ARGUMENTS = ["territory", "city", "location", "locations", "region"] as const;

function renderedText(name: string, args: Record<string, string>): string {
  const rendered = getPrompt(name, args);
  return rendered.messages
    .map((m) => (m.content.type === "text" ? m.content.text : ""))
    .join("\n");
}

/** Prompt → the geo-ish arguments it actually declares. */
function geoArgsOf(name: string): string[] {
  const entry = listPrompts().find((p) => p.name === name);
  return (entry?.arguments ?? [])
    .map((a) => a.name)
    .filter((a) => (GEO_ARGUMENTS as readonly string[]).includes(a));
}

const PROMPTS_WITH_GEO_ARGS = listPrompts()
  .map((p) => p.name)
  .filter((name) => geoArgsOf(name).length > 0);

describe("audit: rendered prompts never instruct a country as a geo value", () => {
  it("there is at least one prompt with a geo argument to check", () => {
    // Guards against the suite silently passing because a rename emptied the
    // list — the failure mode this whole file exists to catch.
    expect(PROMPTS_WITH_GEO_ARGS.length).toBeGreaterThan(0);
  });

  it.each(PROMPTS_WITH_GEO_ARGS)(
    "%s carries the country caveat wherever it names a geo argument",
    (name) => {
      for (const arg of geoArgsOf(name)) {
        for (const value of COUNTRY_LEVEL) {
          const text = renderedText(name, { [arg]: value });

          // The offending shape: an unconditional imperative to pass this value
          // as a location. Matched narrowly — the prompt SHOULD still be able
          // to say "pass it as `locations`" as long as it qualifies the claim.
          const bareImperative = new RegExp(
            `\\*\\*${value.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\*\\*[^.]{0,40}pass it as \`locations\``,
            "i"
          );
          const unqualified = bareImperative.test(text);
          const qualified =
            /ONLY if it names a place INSIDE this workspace/i.test(text) ||
            /is NOT a location filter/i.test(text);

          expect(
            !unqualified || qualified,
            `${name} rendered with ${arg}="${value}" tells the agent to pass it as \`locations\` with no country caveat`
          ).toBe(true);
        }
      }
    }
  );

  it("leadbay_top_accounts_to_activate names the country exception up front", () => {
    // The regression that shipped. Pinned by name because this prompt is the
    // one with a territory argument today, and a generic sweep would stop
    // covering it the moment the argument is renamed.
    const text = renderedText("leadbay_top_accounts_to_activate", { territory: "France" });
    expect(text).toMatch(/is NOT a location filter/i);
    expect(text).toMatch(/supra-national/i);
  });

  it("a real sub-country territory still gets the plain instruction", () => {
    // The caveat must not cost the normal case its answer: a département is a
    // perfectly good territory and must still route to `locations`.
    const text = renderedText("leadbay_top_accounts_to_activate", {
      territory: "Indre-et-Loire",
    });
    expect(text).toContain("Indre-et-Loire");
    expect(text).toMatch(/pass that as `locations`/i);
  });

  it("no prompt leaks an unresolved placeholder when a geo argument is set", () => {
    for (const name of PROMPTS_WITH_GEO_ARGS) {
      for (const arg of geoArgsOf(name)) {
        expect(renderedText(name, { [arg]: "Lyon" }), `${name}/${arg}`).not.toMatch(
          /\{\{arg:/
        );
      }
    }
  });
});
