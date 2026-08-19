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

// KNOWN FLAKE, measured 2026-08-19 on staging. Across 7 live runs (3 FR, 4 US)
// this scenario scored no_fabrication 5 five times and 4 twice, on identical
// code, and the 4 never reproduced when re-run alone — so its reason was never
// captured and no cause is claimed here. Both tenants had an EMPTY Monitor, so
// the agent has no follow-ups to report and improvises around that (one run
// reached for leadbay_pull_leads, which this scenario does not expect); prose
// written around a zero result is where NF varies. That is a property of the
// fixture, not of the rule under test.
//
// What did NOT vary, in any of the 7 runs, read from the raw payloads rather
// than the judge: no country value on any geo argument, pull_followups called
// with no geo at all, no lens write, no country captured to memory, and the
// country named in the answer traced to `_meta.region`. Read a single red run
// here as flake until those five facts break — they are the ticket.
//
// Do NOT "fix" this by lowering NO_FABRICATION_FLOOR: it is shared by every
// scenario. Seeding the tenant with Monitor leads is the real fix.
export const SCENARIO = {
  name: "us-wide-followups-omits-geo",
  // NOT leadbay_followup_check_in, which the first live run proved is not a
  // fetchable prompt at all: it is generated and shipped as a SKILL, but never
  // registered in the server's CATALOG (packages/mcp/src/prompts.ts), so
  // prompts/get throws "Unknown prompt" and the scenario dies before the agent
  // starts. leadbay_extend_my_lens is in the same position.
  //
  // leadbay_top_accounts_to_activate is registered, carries the single-country
  // rule, and lists leadbay_pull_followups in its expected_calls — so it is a
  // real entry point for "which of my known accounts should I work this week".
  // Because it DOES carry the rule, a pass here shows the guarded path holds,
  // not that the tool descriptions alone would; the sibling scenario
  // (country-scope-writes-nothing) is the one that seeds a rule-free prompt.
  prompt: "leadbay_top_accounts_to_activate",
  tier: "gate",
  args: {},
  // The live runner ignores backendFixtures and hits the real API with a real
  // token; the correct behaviour here is read-only, so this scenario mutates
  // nothing on the test tenant.
  backendFixtures: [],
  mission: {
    // Region-RELATIVE on purpose. The first live run exposed the scenario as
    // mis-specified: "across the United States" is the HOME country on a US
    // tenant and a FOREIGN one on FR, and the criteria below were written for
    // the home case. Run on FR staging, the agent correctly refused to answer a
    // US question with French leads — and this scenario marked it wrong for not
    // "still delivering candidates", which would have meant doing exactly what
    // the rule forbids. Naming no country keeps it the home case everywhere.
    // The foreign case is the sibling scenario's job on a non-US tenant.
    user_intent:
      "Which of my leads across the whole country should I follow up with this week?",
    success_criteria: [
      "did NOT pass any country value or whole-country phrase ('United States', 'US', 'France', 'nationwide', 'the whole country') to city, city_id, locations or location_ids on ANY call",
      "called leadbay_pull_followups with NO geo argument at all, because the workspace already covers exactly one country",
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
