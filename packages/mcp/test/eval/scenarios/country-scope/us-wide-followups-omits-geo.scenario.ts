// Eval scenario — OVER-DELIVER guard for the single-country rule
// (product#3951). This is the failure as actually observed: in the 2026-08-02
// E2E acceptance eval, 3/3 independent agent sessions passed a country label to
// a geo argument. One FR session burned six search variants inside the
// resulting invisible fence (the admin-area index has no country nodes, so
// "France" trigram-matched the commune of Francs) and handed the user a
// confident wrong diagnosis.
//
// The over-deliver framing: the agent is given whole-country intent and must
// pass NO geo argument at all, rather than "helpfully" inventing a filter that
// silently narrows the answer to one village.
//
// This is judgeable rather than aspirational because the judge's ledger carries
// tool INPUTS (helpers/mission-match-judge.ts records
// `name(JSON.stringify(input).slice(0,200)) → ok=…`), so "no call carried a
// country value" is something a judge can actually check.
//
// The deterministic red/green proof of the guard itself lives in
// packages/core/test/unit/composite/monitor-country-guard.test.ts. This
// scenario covers the half a unit test cannot: that the agent never sends the
// value in the first place, because a guarded error still burns a turn and can
// still produce a confident wrong narrative.

export const SCENARIO = {
  name: "us-wide-followups-omits-geo",
  // Geographic follow-up intent enters through the check-in prompt, whose
  // TRAVEL / IN-PERSON ROUTING block is one of the surfaces this PR rewrote.
  // This is the real entry point for a follow-up ask, so testing it is right —
  // but be clear about what it proves. `scenario.prompt` is injected as the
  // system prompt, and this prompt now carries the single-country rule, so a
  // pass here does NOT show the tool descriptions alone would hold the line.
  // The unprompted path is covered by the sibling scenario
  // (country-scope-writes-nothing), which seeds a rule-free orientation prompt.
  prompt: "leadbay_followup_check_in",
  tier: "gate",
  args: {},
  // The live runner ignores backendFixtures and hits the real API with a real
  // token; the correct behaviour here is read-only, so this scenario mutates
  // nothing on the test tenant.
  backendFixtures: [],
  mission: {
    user_intent:
      "Which of my leads across the United States should I follow up with this week?",
    success_criteria: [
      "did NOT pass a country value ('United States', 'US', 'USA', 'America') to city, city_id, locations or location_ids on ANY call",
      "called leadbay_pull_followups with NO geo argument at all, because the workspace is already US-only",
      "said the view covers the whole workspace rather than implying it was filtered to a place",
      "did NOT claim a location filter had been applied",
      "did NOT retry several geo spellings looking for one that resolved",
      "still delivered follow-up candidates — the absence of a location filter is not a reason to ask a clarifying question instead of answering",
    ],
    // Exactly one tool, deliberately: the pre-check compares tool names as a set
    // and has no notion of alternatives (helpers/mission-match-judge.ts,
    // preCheckExpectedCalls), so naming an alias in the criteria while requiring
    // only one here would fail a run before the judge ever saw the behaviour the
    // criteria accept. `leadbay_followups_map` is NOT expected for this intent —
    // its triggers are travel/itinerary/map ("I'm going to <city>", "visit in
    // person"), and none of them appear in a weekly follow-up ask.
    required_calls: ["leadbay_pull_followups"],
    required_byproducts: [],
    forbidden_calls: ["leadbay_report_outreach"],
  },
};
