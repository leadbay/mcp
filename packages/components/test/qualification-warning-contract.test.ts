import { describe, expect, it } from "vitest";
import { ARTIFACT_USAGE_GUIDE as GUIDE } from "../../core/src/artifact-runtime.generated.js";

describe("artifact qualification warning contract", () => {
  it("keeps negative evidence visible without treating every negative as a veto", () => {
    const text = GUIDE.replace(/\s+/g, " ");

    expect(text).toContain("`negative_answers`");
    expect(text).toMatch(/visible `⚠` line for every negative answer/i);
    expect(text).toMatch(/not automatically a rejection/i);
    expect(text).toMatch(/null `qualification_summary` means qualification could not be read/i);
    expect(text).toMatch(/empty `negative_answers` array means no returned answer was\s+negative; it does not prove qualification is complete or the lead approved/i);
    expect(text).toMatch(/leave it unresolved rather than implying approval/i);
  });
});
