import { describe, it, expect } from "vitest";
import { STYLES } from "../src/styles.js";

// .lb-btn sets display:inline-flex, which outranks the browser's own [hidden]
// rule. The route planner's "All areas" button, hidden until a city is
// picked, showed from the start.

describe("a hidden kit button is hidden", () => {
  it("the skin restores display:none for .lb-btn[hidden]", () => {
    expect(STYLES).toMatch(/\.lb-btn\[hidden\]\{display:none\}/);
  });

  it("and declares it after the .lb-btn display rule, so it wins on order", () => {
    expect(STYLES.indexOf(".lb-btn[hidden]{display:none}")).toBeGreaterThan(STYLES.indexOf(".lb-btn{display:inline-flex"));
  });
});
