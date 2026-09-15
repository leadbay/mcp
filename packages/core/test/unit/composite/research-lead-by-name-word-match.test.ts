/**
 * product#4130 — what counts as the same company in a name lookup.
 *
 * Pairs replayed from FR production leads, 2026-09-15. The /search/suggest
 * typeahead returns every one of them today. A typo, a last word cut short, a
 * run-together name or a legal form is the same company. A different word is
 * not.
 */

import { describe, expect, it } from "vitest";
import { isWordMatch } from "../../../src/composite/research-lead-by-name-fuzzy.js";

const company = (text: string) => ({ text, match_type: "COMPANY" as const });

describe("isWordMatch — a typo is the same company, another word is not", () => {
  it.each([
    ["Leadbey", "LEADBAY"],
    ["Acme Ro", "Acme Robotics"],
    ["Wink Lab", "WINKLAB"],
    ["Wink Lab", "WINK"],
    ["IPC FRANCE SAS", "IPC FRANCE SA"],
    ["Leadbey SAS", "LEADBAY"],
    ["Société Générale", "SOCIETE GENERALE"],
    ["SC2L FINANCE (SC2L FINANCE)", "SC2L FINANCE"],
  ])("%s finds %s", (query, name) => {
    expect(isWordMatch(query, company(name))).toBe(true);
  });

  it.each([
    ["THEOMA GESTION PRIVEE", "PILOTE GESTION"],
    ["SC2L FINANCE (SC2L FINANCE)", "VALOIS FINANCE"],
    ["AK CONSEILS", "AOL CONSEILS"],
    ["2P INVEST", "INVESTED"],
  ])("%s does not find %s", (query, name) => {
    expect(isWordMatch(query, company(name))).toBe(false);
  });

  it("keeps contact and domain hits, which the backend matched by word and substring", () => {
    expect(isWordMatch("Hugo Flusin", { text: "Hugo Flusin", match_type: "PERSON", company_name: "ACME" })).toBe(true);
    expect(isWordMatch("wink-lab", { text: "wink-lab.com", match_type: "DOMAIN", company_name: "WINK" })).toBe(true);
  });
});
