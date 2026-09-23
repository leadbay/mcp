/**
 * Audit for the `{{render}}` split.
 *
 * A block that leaves a description must ARRIVE somewhere, and it must obey
 * the same commerce rule the description obeys. Three ways this can rot:
 *
 *   1. a block is lifted out and nothing serves it back (the layout is lost);
 *   2. the block is served but its text is still inside the description too
 *      (we pay for it twice and the host truncates it anyway);
 *   3. a block carrying `{{commerce}}` prose reaches the ChatGPT surface,
 *      which is the rejection we already took once (product#3943).
 *
 * Deterministic source-side audit; it does not exercise the LLM.
 *
 * New file — does not modify an existing audit.
 */
import { describe, it, expect } from "vitest";
import {
  RENDER_BLOCKS,
  NO_COMMERCE_RENDER_BLOCKS,
  RENDER_RECIPES,
  NO_COMMERCE_RENDER_RECIPES,
  renderGuide,
  compositeReadTools,
  LeadbayClient,
} from "@leadbay/core";
import * as Generated from "@leadbay/core/dist/tool-descriptions.generated.js";

const descriptions = Generated as Record<string, unknown>;

/** First line of prose in a block, long enough to be unique in a description. */
const fingerprint = (block: string) =>
  block
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 60 && !l.startsWith("#")) ?? block.slice(0, 80);

describe("render blocks leave the description and arrive on the result", () => {
  it("every block has a one-line recipe to ride on the result", () => {
    for (const name of Object.keys(RENDER_BLOCKS)) {
      expect(RENDER_RECIPES[name], `${name} has a render block but no recipe`).toBeTruthy();
    }
  });

  it("no block is still inside the description it came from", () => {
    for (const [name, block] of Object.entries(RENDER_BLOCKS)) {
      const description = descriptions[name] as string | undefined;
      expect(description, `${name} has a render block but no description`).toBeTruthy();
      expect(
        description!.includes(fingerprint(block)),
        `${name}: the render block is still in the description`,
      ).toBe(false);
    }
  });

  it("the guide tool is on the default surface, or the layout is unreachable", () => {
    expect(compositeReadTools.map((t) => t.name)).toContain("leadbay_render_guide");
    expect(renderGuide.annotations?.readOnlyHint).toBe(true);
  });

  it("serves the full block for a tool that has one", async () => {
    const client = new LeadbayClient("https://api-us.leadbay.app", "u.t", "us");
    const res: any = await renderGuide.execute(client, { tool: "leadbay_pull_leads" });
    expect(res.guide).toContain("RENDERING");
    expect(res.available).toContain("leadbay_pull_leads");
  });

  it("answers a tool without a guide plainly instead of erroring", async () => {
    const client = new LeadbayClient("https://api-us.leadbay.app", "u.t", "us");
    const res: any = await renderGuide.execute(client, { tool: "leadbay_like_lead" });
    expect(res.guide).toBeNull();
    expect(res.hint).toContain("leadbay_render_guide");
    expect(res.hint).toContain("markdown");
  });

  it("serves the commerce-free variant when commerce is gated off", async () => {
    const client = new LeadbayClient("https://api-us.leadbay.app", "u.t", "us");
    client.commerce = false;
    for (const [name, stripped] of Object.entries(NO_COMMERCE_RENDER_BLOCKS)) {
      const res: any = await renderGuide.execute(client, { tool: name });
      expect(res.guide, `${name} must serve its stripped block on a commerce-free surface`).toBe(
        stripped,
      );
      expect(res.guide.length).toBeLessThan(RENDER_BLOCKS[name].length);
    }
  });

  it("a recipe that names a purchase has a commerce-free twin", () => {
    // The recipe rides on EVERY result, so it needs the gate the block has.
    // leadbay_extend_lens's rendering_hint names a top-up today, which is how
    // this would reach ChatGPT ungated the moment that tool is migrated.
    for (const [name, recipe] of Object.entries(RENDER_RECIPES)) {
      if (!/top.?up|upgrade plan|checkout|buy credits|purchase/i.test(recipe)) continue;
      expect(
        NO_COMMERCE_RENDER_RECIPES[name],
        `${name}'s recipe mentions a purchase but has no commerce-free variant`,
      ).toBeTruthy();
    }
  });

  it("every commerce-free recipe is a subsequence of the full one", () => {
    for (const [name, stripped] of Object.entries(NO_COMMERCE_RENDER_RECIPES)) {
      const full = RENDER_RECIPES[name];
      let i = 0;
      for (const ch of stripped) {
        i = full.indexOf(ch, i);
        expect(i, `${name}: commerce-free recipe is not a subsequence`).toBeGreaterThan(-1);
        i += 1;
      }
    }
  });

  it("every commerce-free block is a subsequence of the full one (deleted, not reworded)", () => {
    for (const [name, stripped] of Object.entries(NO_COMMERCE_RENDER_BLOCKS)) {
      const full = RENDER_BLOCKS[name];
      let i = 0;
      for (const ch of stripped) {
        i = full.indexOf(ch, i);
        expect(i, `${name}: commerce-free block is not a subsequence of the full block`).toBeGreaterThan(-1);
        i += 1;
      }
    }
  });
});
