import { describe, expect, it } from "vitest";
import { leadbay_research_lead_by_name_fuzzy } from "@leadbay/core/src/tool-descriptions.generated.js";
import { getPrompt, listPrompts } from "../src/prompts.js";

describe("company research review regressions", () => {
  it("accepts a company name through the backward-compatible domain argument", () => {
    const prompt = listPrompts().find(
      (candidate) => candidate.name === "leadbay_research_a_domain"
    );
    const argument = prompt?.arguments?.find(
      (candidate) => candidate.name === "domain"
    );
    expect(argument?.description).toContain("Company name or domain");

    const result = getPrompt("leadbay_research_a_domain", {
      domain: "Acme Corporation",
    });
    const text = result.messages[0].content as { type: "text"; text: string };
    expect(text.text).toContain(
      "Research the company name or domain 'Acme Corporation'"
    );
    expect(text.text).toContain(
      "`companyName:'Acme Corporation'`"
    );
  });

  it("keeps the fuzzy resolver below the 16k composite soft budget", () => {
    expect(leadbay_research_lead_by_name_fuzzy.length).toBeLessThanOrEqual(
      16_000
    );
  });
});
