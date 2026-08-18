/**
 * Regression audit for the single-country-universe rule (product#3951).
 *
 * The invariant: every tool that accepts a location argument, and every prompt
 * that routes geographic intent, must carry the rule that a country name is
 * never a location filter — because each Leadbay backend serves exactly ONE
 * country, so whole-country intent means omitting the filter entirely.
 *
 * History (2026-08-02 E2E acceptance eval): 3/3 independent agent sessions
 * passed a country label. The root cause was NOT a missing rule — it was a
 * CONTRADICTING one. The shipped descriptions actively instructed it:
 * followups-map.md.tmpl told the agent to "pass any place name there: states…,
 * countries ("France", "United States")" and claimed "/geo/search indexes all
 * levels — level 4 (state), level 2 (country), level 5 (city)". The agents were
 * following the guidance. Meanwhile the admin-area index has no country nodes
 * (product#3885), so "France" trigram-matched the commune of Francs and one FR
 * session burned six variants inside that invisible fence.
 *
 * So this audit has two halves, and the second is the load-bearing one:
 *   1. the rule is PRESENT in every location-accepting surface, and
 *   2. no surface still tells the agent that a country is a valid geo value.
 *
 * Deterministic source-side audit — it does not exercise the LLM. The
 * end-to-end half lives in test/eval/scenarios/country-scope/ behind EVAL=1.
 * This catches regressions in the SOURCE prompts; the eval catches drift in the
 * LLM's interpretation.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import * as Generated from "@leadbay/core/dist/tool-descriptions.generated.js";
import { COUNTRY_LEVEL_LOCATION } from "@leadbay/core/dist/composite/_country-guard.js";
import * as Prompts from "../../src/prompts.generated.js";
import { PROMPT_META } from "../../src/prompts.generated.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");
const SNIPPET_PATH = resolve(
  REPO_ROOT,
  "packages/promptforge/snippets/heuristics/single-country-universe.md"
);

/**
 * Every tool that accepts a location argument. If you add one, add it here —
 * the audit refuses to let a new geo-accepting tool skip the rule.
 *
 * Intentionally EXCLUDED: leadbay_pull_leads / leadbay_extend_lens /
 * leadbay_seed_candidates (no geo argument — geography lives on the lens), and
 * leadbay_campaign_call_sheet / leadbay_research_lead_by_id / the tour_plan
 * render block (they RENDER `location.country`, they never filter on it).
 */
const TOOLS_THAT_ACCEPT_LOCATIONS = [
  "leadbay_pull_followups",
  "leadbay_followups_map",
  "leadbay_tour_plan",
  "leadbay_scan_portfolio_signals",
  "leadbay_new_lens",
  "leadbay_adjust_audience",
  "leadbay_list_locations",
  "leadbay_update_lens_filter",
] as const;

/**
 * Prompts that can receive geographic intent — either through a declared geo
 * argument or through a free-text audience/instruction a user can phrase as a
 * whole country. product#3951 names all five.
 *
 * `refine_audience` and `setup_team_prospecting` are here for a reason worth
 * keeping: neither has a geo ARGUMENT, so a sweep that only followed geo params
 * skips them — which is exactly what happened on the first pass of this PR. But
 * "scope my lens to the whole US" lands in refine_audience, and
 * setup_team_prospecting's free-text `audience` / `rep_split` can both carry a
 * country. Absence of a geo param is not absence of geo intent.
 */
const PROMPTS_WITH_GEO_INTENT = [
  "leadbay_followup_check_in",
  "leadbay_top_accounts_to_activate",
  "leadbay_plan_tour_in_city",
  "leadbay_refine_audience",
  "leadbay_setup_team_prospecting",
] as const;

const RULE = readFileSync(SNIPPET_PATH, "utf8");
const HEADLINE = /a country name is NEVER a location filter/i;
const OMIT = /omit the geo argument/i;

/**
 * Phrasings that tell the agent a country IS a valid geo value. Each pattern
 * carries the file:line it was written for. Deliberately NOT a bare
 * /\bcountry\b/ — `location.country` is a real render field, "State or Country"
 * is a legitimate place-card heading, and the list-locations legend has to be
 * able to say country nodes are absent.
 */
const CONTRADICTIONS: ReadonlyArray<{ pattern: RegExp; origin: string }> = [
  {
    // followups-map.md.tmpl:47, pull-followups.md.tmpl:71 — countries offered
    // as a value to pass, with worked examples.
    pattern: /countr(y|ies) \(`"/,
    origin: 'countries offered as a passable value, e.g. `countries ("France", "United States")`',
  },
  {
    // followups-map:47, adjust-audience:54, new-lens:62, tour-plan:58 —
    // "any/every admin level … country". The list-locations legend says admin
    // DEPTH, not "admin level", so it does not trip this.
    // NOTE this also trips on a hedged "every admin level BELOW country" —
    // deliberately. The fix is to ENUMERATE the levels the argument accepts
    // ("state / région / département / county / city") rather than to describe
    // them relative to a level the agent must never use; naming country in the
    // same breath as the accepted range is what made the agent try it.
    pattern: /(any|every|all|across) (the )?admin levels?[^.\n]{0,140}\bcountry\b/i,
    origin: '"resolves any/every admin level … country"',
  },
  {
    // followups-map:47 — country advertised as a searchable index level.
    pattern: /level 2 \(country\)/i,
    origin: '"level 2 (country)" advertised as searchable',
  },
  {
    // pull-followups.md.tmpl:13 — the trigger phrase itself.
    pattern: /<city ?\/ ?state ?\/ ?country>/i,
    origin: 'the trigger phrase "leads in <city / state / country>"',
  },
];

/** Strip the rule's own text so it may say "never pass a country" freely. */
const withoutRule = (text: string) => text.split(RULE).join("");

describe("audit: single-country-universe rule", () => {
  it("the shared snippet states the rule, the mechanism and the recovery", () => {
    expect(RULE).toMatch(HEADLINE);
    expect(RULE).toMatch(OMIT);
    // The concrete measured failures are what make the rule stick.
    expect(RULE).toMatch(/Francs/);
    expect(RULE).toMatch(/Statesboro/);
    // The recovery step, keyed off the runtime error code.
    expect(RULE).toContain(COUNTRY_LEVEL_LOCATION);
    expect(RULE).toMatch(/do NOT retry with another spelling/i);
    // The tiebreak an agent needs when the user names both.
    expect(RULE).toMatch(/Keep the city, drop the country/i);
  });

  it("the snippet keeps foreign countries SEPARATE from the home country", () => {
    // The accuracy regression this pins: an earlier draft told the agent to
    // "pass no geo argument" for a country only OR a supra-national scope,
    // lumping them with the home country. On a US workspace that turns "leads in
    // France" — an UNSUPPORTED request — into an unfiltered run that returns US
    // leads as though they answered it. Only the HOME country is equivalent to
    // "no filter".
    expect(RULE, "the rule must distinguish the three cases").toMatch(
      /unsupported, not unfiltered/i
    );
    expect(RULE, "it must forbid re-running unfiltered for a foreign country").toMatch(
      /Do NOT re-run without the argument/i
    );
    // And it must point at the runtime field that says WHICH case this is.
    for (const kind of ["home_country", "foreign_country", "supranational", "country_indeterminate"]) {
      expect(RULE, `the rule must name the ${kind} branch`).toContain(kind);
    }
  });

  it("the snippet carries the EXCLUSION recovery, not just the include one", () => {
    // Every recovery in this rule was written for an include, and each inverts on
    // an exclude axis: "omit the argument" returns the very companies the user
    // asked to remove. Both new_lens and adjust_audience carry this snippet and
    // both accept exclude_locations, so a missing exclusion branch here can
    // persist an audience that includes everything the user excluded.
    expect(RULE, "the rule must key the recovery off the axis").toContain("axis");
    expect(RULE, "it must forbid the omit advice on an exclusion").toMatch(
      /never "omit the argument"/i
    );
    expect(RULE, "it must say what excluding the home country does").toMatch(
      /would empty it/i
    );
    expect(RULE, "it must say excluding a foreign country is a no-op").toMatch(
      /no-op/i
    );
  });

  it("the runtime error code is the one the snippet teaches", () => {
    // Imported from core rather than hardcoded: a rename there must not
    // silently leave the prose teaching a recovery for an error that no longer
    // exists while this audit still passes.
    expect(COUNTRY_LEVEL_LOCATION).toBe("COUNTRY_LEVEL_LOCATION");
  });

  it.each(TOOLS_THAT_ACCEPT_LOCATIONS)(
    "%s carries the single-country rule",
    (toolName) => {
      const desc = (Generated as Record<string, string>)[toolName];
      expect(
        desc,
        `tool ${toolName} is missing from the generated descriptions — add it, or remove it from TOOLS_THAT_ACCEPT_LOCATIONS in this audit if it no longer takes a location argument`
      ).toBeTruthy();
      expect(
        desc,
        `${toolName} has lost the single-country rule; re-add {{include:heuristics/single-country-universe}} to its template (product#3951)`
      ).toMatch(HEADLINE);
      expect(
        desc,
        `${toolName} states the rule but not the recovery step; the include must carry ${COUNTRY_LEVEL_LOCATION}`
      ).toContain(COUNTRY_LEVEL_LOCATION);
    }
  );

  it.each(PROMPTS_WITH_GEO_INTENT)(
    "%s carries the single-country rule",
    (promptName) => {
      const body = (Prompts as Record<string, string>)[promptName];
      expect(
        body,
        `prompt ${promptName} is missing from prompts.generated.ts`
      ).toBeTruthy();
      expect(
        body,
        `${promptName} has lost the single-country rule; re-add {{include:heuristics/single-country-universe}} (product#3951)`
      ).toMatch(HEADLINE);
    }
  );

  // ── The half that matters: no surviving contradiction ────────────────────
  it.each(TOOLS_THAT_ACCEPT_LOCATIONS)(
    "%s does not also tell the agent a country IS a valid geo value",
    (toolName) => {
      const other = withoutRule((Generated as Record<string, string>)[toolName]);
      const found = CONTRADICTIONS.filter((c) => c.pattern.test(other));
      expect(
        found.map((c) => c.origin),
        `${toolName} contradicts the single-country rule. An agent resolving "never pass a country" against "pass a country" does the concrete thing — that is exactly how 3/3 eval sessions failed. Rewrite the clause to say "every level BELOW country" instead of appending the rule (product#3951)`
      ).toEqual([]);
    }
  );

  /**
   * Prompts that GATE on a country themselves, rather than only carrying the
   * shared rule. Each one decides whether to stop, so each one has to make the
   * home-vs-foreign distinction in its own words — and each one got it wrong on
   * the first pass, in the same way: a combined "whole-country or supra-national"
   * branch that answers a France request with US data.
   */
  const PROMPTS_WITH_COUNTRY_GATE = [
    "leadbay_refine_audience",
    "leadbay_setup_team_prospecting",
    "leadbay_top_accounts_to_activate",
  ] as const;

  it.each(PROMPTS_WITH_COUNTRY_GATE)(
    "%s gates on a country WITHOUT conflating home with foreign",
    (promptName) => {
      const body = withoutRule((Prompts as Record<string, string>)[promptName]);
      expect(body, `prompt ${promptName} is missing from prompts.generated.ts`).toBeTruthy();

      // It must name the foreign case separately from the home case.
      expect(
        body,
        `${promptName} gates on a country but never distinguishes a DIFFERENT country. Only the home country maps to "nothing to set" / an unfiltered result; a foreign ask is UNSUPPORTED and must be reported as such (product#3951)`
      ).toMatch(/a different country/i);

      // And it must not carry the constructions that conflated them. Each of
      // these shipped once and answered a foreign request with home-country data.
      const conflations: ReadonlyArray<{ pattern: RegExp; origin: string }> = [
        {
          pattern: /whole-country or supra-national/i,
          origin: 'the combined "whole-country or supra-national" branch',
        },
        {
          pattern: /is a country, scope NOTHING/i,
          origin: '"if the territory is a country, scope NOTHING"',
        },
        {
          pattern: /carries a whole-country scope[^.]*drop that clause/i,
          origin: '"carries a whole-country scope → drop that clause"',
        },
      ];
      const found = conflations.filter((c) => c.pattern.test(body));
      expect(
        found.map((c) => c.origin),
        `${promptName} still treats any country as the home country. Split the branches: home → proceed unfiltered; foreign / supra-national → stop and report it unsupported`
      ).toEqual([]);
    }
  );

  /**
   * The tour is the ONE geo tool whose country recovery is not "omit the
   * argument". `leadbay_tour_plan` accepts a missing `city` and answers with
   * unfiltered Monitor leads plus arbitrary Discover leads — a nationwide list
   * presented as an itinerary. Its body says so, but the body is not what a
   * truncating host reads: the routing block lands in the first ~500 chars
   * (CLAUDE.md) and the prompt's argument description is surfaced on its own in
   * `prompts/list`. Both of those shipped carrying the generic omit recovery,
   * contradicting the override further down. Pinned per-surface so a later
   * wording pass cannot reintroduce the shorter, more visible, wrong answer.
   */
  it("the tour's EARLY surfaces send the agent to ask, not to omit", () => {
    const whenToUse = /## WHEN TO USE\n([\s\S]*?)(?=\n## |\n---)/.exec(
      (Generated as Record<string, string>).leadbay_tour_plan
    )?.[1];
    const cityArg = PROMPT_META.leadbay_plan_tour_in_city.arguments?.find(
      (a) => a.name === "city"
    )?.description;

    const surfaces: ReadonlyArray<{ where: string; text: string | undefined }> = [
      { where: "leadbay_tour_plan routing block", text: whenToUse },
      { where: "leadbay_plan_tour_in_city `city` argument", text: cityArg },
    ];

    // Each phrasing below shipped on one of these two surfaces, or is the
    // shared snippet's include-recovery leaking into a place that overrides it.
    const OMIT_RECOVERY: ReadonlyArray<{ pattern: RegExp; origin: string }> = [
      { pattern: /means NO geo filter/i, origin: '"a whole-country ask means NO geo filter"' },
      { pattern: /needs no geo filter/i, origin: '"a whole-country ask needs no geo filter at all"' },
      { pattern: /omit the geo argument/i, origin: "the shared include-axis recovery" },
    ];

    for (const { where, text } of surfaces) {
      expect(text, `${where} did not parse out of the generated file`).toBeTruthy();
      const found = OMIT_RECOVERY.filter((c) => c.pattern.test(text as string));
      expect(
        found.map((c) => c.origin),
        `${where} tells the agent to drop the geo filter on a country-wide ask. A city-less tour_plan returns arbitrary whole-workspace leads, not an itinerary — this surface must send the agent to ASK for a city or region (product#3951)`
      ).toEqual([]);
      expect(
        text,
        `${where} must state the tour exception explicitly: do NOT omit the argument`
      ).toMatch(/do NOT omit/i);
      expect(
        text,
        `${where} must name the recovery it replaces omission with: ask which city or region`
      ).toMatch(/ask which city or region/i);
    }
  });

  it("the team-setup prompt passes a SANITIZED audience, not the raw argument", () => {
    // Dropping the country in prose while still interpolating {{arg:audience}}
    // sent the country label to the lens anyway.
    const body = (Prompts as Record<string, string>).leadbay_setup_team_prospecting;
    expect(body).toMatch(/pass the SANITIZED text/i);
    expect(
      body,
      "the refine_prompt call must not interpolate the raw audience argument after asking the agent to strip a country from it"
    ).not.toMatch(/leadbay_refine_prompt\(\{user_prompt: "\{\{arg:audience\}\}"\}\)/);
  });

  it("no prompt legitimizes country-level place names", () => {
    const violations: string[] = [];
    for (const promptName of PROMPTS_WITH_GEO_INTENT) {
      const body = withoutRule((Prompts as Record<string, string>)[promptName]);
      // leadbay_followup_check_in:41 used to route on "leads in Texas /
      // California / France … INCLUDING state-, country-, and region-level
      // place names".
      if (/country-level place names?/i.test(body)) {
        violations.push(`${promptName}: "country-level place names"`);
      }
      if (/state-,? country-,? and region-/i.test(body)) {
        violations.push(`${promptName}: "state-, country-, and region-level"`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("every geo-accepting tool description stays within the char budget", () => {
    // The rule is ~1.1k chars landing in 8 descriptions, and pull_followups was
    // 52 chars from the cap before this change. Re-measured here so a later
    // wording pass cannot quietly push it over.
    const over: string[] = [];
    for (const toolName of TOOLS_THAT_ACCEPT_LOCATIONS) {
      const desc = (Generated as Record<string, string>)[toolName];
      if (desc.length > 17000) over.push(`${toolName}: ${desc.length}`);
    }
    expect(over).toEqual([]);
  });
});
