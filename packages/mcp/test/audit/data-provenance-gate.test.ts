/**
 * Audit — the account-activation plan carries its data-provenance contract.
 *
 * product#3863: the top-accounts deliverable mixes client ERP figures,
 * Leadbay responses, public-registry counts and modelled assumptions, and it
 * is shown to a paying client. The load-bearing property is that every number
 * declares its source and that un-sourceable fields are visibly OMITTED rather
 * than quietly estimated. These assertions pin the gate into the generated
 * prompt so a template edit can't silently drop it.
 */
import { describe, expect, it } from "vitest";
import {
  leadbay_top_accounts_to_activate,
  PROMPT_META,
} from "../../src/prompts.generated.js";
import { getPrompt, listPrompts } from "../../src/prompts.js";

const MOTIFS = [
  "SAUVETAGE",
  "PLAN DE COMPTE",
  "MONTÉE EN GAMME",
  "RÉVEIL",
  "CONQUÊTE",
];

describe("audit: data-provenance gate (leadbay_top_accounts_to_activate)", () => {
  it("the prompt is registered in the catalog with its four arguments", () => {
    const entry = listPrompts().find(
      (p) => p.name === "leadbay_top_accounts_to_activate",
    );
    expect(entry).toBeDefined();
    const argNames = (entry!.arguments ?? []).map((a) => a.name).sort();
    expect(argNames).toEqual(["benchmark", "count", "erp_extract", "territory"]);
    // Every argument is optional — the prompt must be invocable bare.
    expect((entry!.arguments ?? []).every((a) => !a.required)).toBe(true);
  });

  it("carries the four provenance classes and the ledger byproduct", () => {
    for (const tag of ["[ERP]", "[LB]", "[SIRENE]", "[HYP]"]) {
      expect(leadbay_top_accounts_to_activate).toContain(tag);
    }
    expect(leadbay_top_accounts_to_activate).toContain("PROVENANCE LEDGER");
    // An un-sourceable field must be rendered, not dropped.
    expect(leadbay_top_accounts_to_activate).toContain("OMITTED");
  });

  it("names the ranking-key fabrication trap explicitly", () => {
    // The single most likely failure: inventing a revenue figure purely so a
    // "sort by cash" ranking produces a plausible order.
    expect(leadbay_top_accounts_to_activate).toContain(
      "Sorting is where fabrication hides",
    );
  });

  it("declares all five activation motifs", () => {
    for (const motif of MOTIFS) {
      expect(leadbay_top_accounts_to_activate).toContain(motif);
    }
  });

  it("pins the Monitor-membership caveat (imported leads are not clients)", () => {
    // import-leads: imported leads are NOT auto-promoted to Monitor — lens
    // scoring decides. Equating the two mislabels every imported account.
    expect(leadbay_top_accounts_to_activate).toContain(
      "NOT auto-promoted",
    );
  });

  it("pins the enrichment double-spend caveat", () => {
    expect(leadbay_top_accounts_to_activate).toContain("double-spend");
  });

  it("requires the degraded mode to stay a real deliverable", () => {
    expect(leadbay_top_accounts_to_activate).toContain("DEGRADED MODE");
    expect(PROMPT_META.leadbay_top_accounts_to_activate.failure_modes).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Refuses the whole task"),
      ]),
    );
  });

  it("declares the no-fabrication failure mode first (highest severity)", () => {
    const modes =
      PROMPT_META.leadbay_top_accounts_to_activate.failure_modes ?? [];
    expect(modes.length).toBeGreaterThan(0);
    expect(modes[0]).toContain("Invents, estimates or proxies a revenue");
  });

  it("renders with defaults when invoked bare (count falls back to 50)", () => {
    const rendered = getPrompt("leadbay_top_accounts_to_activate", {});
    const text = JSON.stringify(rendered.messages);
    expect(text).toContain("top-50");
    // No unresolved placeholders leak into the rendered prompt.
    expect(text).not.toMatch(/\{\{arg:/);
  });

  it("honors an explicit count and territory", () => {
    const rendered = getPrompt("leadbay_top_accounts_to_activate", {
      count: "25",
      territory: "Indre-et-Loire",
    });
    const text = JSON.stringify(rendered.messages);
    expect(text).toContain("top-25");
    expect(text).toContain("Indre-et-Loire");
    expect(text).not.toMatch(/\{\{arg:/);
  });

  it("tells the agent to establish mode when no extract is supplied", () => {
    const rendered = getPrompt("leadbay_top_accounts_to_activate", {});
    const text = JSON.stringify(rendered.messages);
    // An omitted `erp_extract` argument must NOT be rendered as "no extract
    // exists" — the user may have attached one in the surrounding chat.
    expect(text).toContain("does NOT mean no extract exists");
    expect(text).not.toContain("I have NOT given you a revenue extract");
    expect(text).toContain("rather than inventing one");
  });
});
