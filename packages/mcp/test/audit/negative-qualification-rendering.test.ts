/** Regression audit for issue #254's agent-facing rendering contract. */

import { describe, expect, it } from "vitest";
import * as Descriptions from "@leadbay/core/dist/tool-descriptions.generated.js";
import * as Prompts from "../../src/prompts.generated.js";

const collapse = (value: string) => value.replace(/\s+/g, " ");

describe("negative qualification rendering", () => {
  it("pull_leads exposes negative evidence without making every negative an automatic veto", () => {
    const description = collapse(Descriptions.leadbay_pull_leads);

    expect(description).toContain("qualification_summary.negative_answers");
    expect(description).toMatch(/every (?:returned )?negative/i);
    expect(description).toMatch(/stated customer veto excludes|explicit customer vetoes exclude/i);
    expect(description).toMatch(/null.*unavailable.*(?:not|never).*pass/i);
    expect(description).toMatch(/\[\].*not complete or approved/i);
    expect(description).toMatch(/unresolved.*without inferring approval|neither auto-exclude nor approve/i);
  });

  it("the second consumer and selection prompts carry the same rule", () => {
    const surfaces = [
      Descriptions.leadbay_tour_plan,
      Prompts.leadbay_daily_check_in,
      Prompts.leadbay_build_campaign,
    ];

    for (const surface of surfaces) {
      const text = collapse(surface);
      expect(text).toContain("negative_answers");
      expect(text).toMatch(/stated criteria|explicit.*veto|customer-stated/i);
      expect(text).toMatch(/null.*unavailable|could not be read/i);
      expect(text).toMatch(/\[\].*not complete or approved|no returned answer.*not complete or approved/i);
      expect(text).toMatch(/unresolved.*(?:not.*approved|rather than treating.*approved)|neither auto-exclude nor approve/i);
    }
  });
});
