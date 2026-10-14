import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Seen on first render: the route planner's map was a short strip until the
// lead list arrived. The page is a 3-row grid (top bar, notice, work area)
// whose third row fills the height; with no notice (display:none) the work
// area moved up into the second, `auto`, row and took the panel's height.

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, "../src/templates/route-planner/page.html"), "utf8");

describe("the route planner's map fills the height from the first render", () => {
  it("the notice row is hidden when the notice is empty", () => {
    expect(page).toMatch(/\.notice:empty\s*\{\s*display:\s*none;?\s*\}/);
  });

  it("and the grid then has two rows, the work area on the fill row", () => {
    expect(page).toMatch(/\.app:has\(>\s*\.notice:empty\)\s*\{\s*grid-template-rows:\s*auto 1fr;?\s*\}/);
  });
});
