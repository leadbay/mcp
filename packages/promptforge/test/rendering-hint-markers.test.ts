/**
 * A `rendering_hint` carries its own `{{commerce}}` markers, and since the
 * `{{render}}` split it is no longer folded into the description body, so the
 * body's marker validation stops seeing it. The hint still ships: it is the
 * one-line recipe on every result of a migrated tool, and it has a
 * commerce-free twin for ChatGPT (leadbay_extend_lens's names a top-up).
 *
 * An unbalanced marker there would reach users as a literal `{{commerce}}`,
 * and would have failed nothing. This pins the check.
 *
 * New file.
 */
import { describe, it, expect } from "vitest";
import { validateCommerceMarkers, renderCommerce } from "../src/commerce.js";

describe("rendering_hint commerce markers", () => {
  it("accepts a balanced pair and strips it for the commerce-free surface", () => {
    const hint = "Show the three windows{{commerce}}, then the top-up line{{/commerce}}.";
    expect(validateCommerceMarkers(hint)).toBeNull();
    expect(renderCommerce(hint, "with")).toContain("top-up line");
    expect(renderCommerce(hint, "without")).not.toContain("top-up line");
    expect(renderCommerce(hint, "without")).toContain("Show the three windows");
  });

  it("rejects an unbalanced marker rather than shipping the literal", () => {
    expect(validateCommerceMarkers("Show the windows{{commerce}} and the top-up.")).toMatch(
      /unbalanced/,
    );
    expect(validateCommerceMarkers("Show the windows{{/commerce}}")).toMatch(/unbalanced/);
  });

  it("every shipped hint is balanced", async () => {
    const { ROUTING_EXAMPLES: _ignore, ...rest } = await import("@leadbay/core");
    const recipes = (rest as Record<string, Record<string, string>>).RENDER_RECIPES ?? {};
    for (const [name, recipe] of Object.entries(recipes)) {
      expect(recipe, `${name}'s recipe leaked a marker`).not.toContain("{{commerce}}");
      expect(recipe, `${name}'s recipe leaked a marker`).not.toContain("{{/commerce}}");
    }
  });
});
