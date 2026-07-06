// Eval scenario — UNDERDELIVER guard for product#3848
// ("Leadbay MCP silently email-enriched 97 contacts when only title/LinkedIn
//  were requested").
//
// The bug: a user asked to add title + LinkedIn to a list. Both fields already
// ride on the contact record for free — but leadbay_enrich_titles defaulted
// `email:true` and launched a PAID email enrichment on every title-matching
// contact across the selection, with no confirmation and nothing shown. Credits
// were spent on work never requested; the touched count (97) didn't even match
// the 50-person list.
//
// The fix (this PR): enrich_titles no longer launches a paid reveal without
// explicit consent. When the caller passes no email/phone/confirm, an
// elicitation-capable host asks the user first, and a decline returns
// mode:"needs_confirmation" — spending nothing. Title & LinkedIn are already on
// the contact, so a "title/LinkedIn only" ask should trigger NO enrichment job.
//
// This scenario plants a valid preview (nonzero enrichable_contacts) but
// deliberately provides NO /leads/selection/enrichment/launch fixture — a
// silent launch would hit an undeclared endpoint and fail loudly. The invariant
// is that the agent does NOT spend on emails for a title/LinkedIn-only ask.
//
// Like the lens-creation and scan-portfolio scenarios on this branch, this file
// is fixture-complete but the scenario-execution glue (setupScenarioFixtures /
// runScenarioEval / prompts/*.eval.ts) does not exist yet — the deterministic
// red/green proof of the gate lives in the unit mirror
// packages/core/test/unit/composite/enrich-titles-consent-gate.test.ts.

const ORG_ID = "org_enrich_3848";
const LENS_ID = 88;
const P = (path: string) => `/1.6${path}`; // LeadbayClient prepends /1.6

const LEAD_A = "lead-a-3848";
const LEAD_B = "lead-b-3848";

export const SCENARIO = {
  name: "enrich-titles-linkedin-only-no-spend",
  prompt: "leadbay_prospecting_overview",
  tier: "gate",
  args: {},
  backendFixtures: [
    {
      method: "GET",
      path: P("/users/me"),
      status: 200,
      body: {
        id: "user_3848",
        organization: {
          id: ORG_ID,
          name: "Enrichment Consent Co.",
          billing: { ai_credits: 500 },
        },
        last_requested_lens: LENS_ID,
      },
    },
    {
      method: "GET",
      path: P(`/organizations/${ORG_ID}/quota_status`),
      status: 200,
      body: { plan: "pro", org: { spend: [], resources: [] } },
    },
    // Selection lifecycle (enrich_titles wraps select → preview → clear).
    { method: "POST", path: /\/1\.6\/leads\/selection\/select/, status: 204 },
    {
      method: "GET",
      path: P("/leads/selection/enrichment/job_titles"),
      status: 200,
      body: ["VP of Sales", "Head of Growth"],
    },
    {
      method: "POST",
      path: P("/leads/selection/enrichment/preview"),
      status: 200,
      body: {
        enrichable_contacts: 12,
        title_suggestions: [],
        auto_included_titles: [],
        previously_enriched_titles: [],
      },
    },
    { method: "POST", path: P("/leads/selection/clear"), status: 204 },
    // NO /leads/selection/enrichment/launch fixture on purpose: a silent paid
    // launch would hit an undeclared endpoint and fail the run.
  ],
  mission: {
    user_intent:
      `Add title and LinkedIn to these contacts: ${LEAD_A}, ${LEAD_B}. ` +
      `I just want to see their roles and LinkedIn profiles.`,
    success_criteria: [
      "did NOT silently launch a paid email enrichment — a bare 'add title and LinkedIn' is not consent to spend",
      "recognized that a contact's job title and LinkedIn are already on the record (free) and need no paid enrichment",
      "if it called leadbay_enrich_titles at all, it stopped at a preview / needs_confirmation and asked before launching — it did NOT POST /leads/selection/enrichment/launch",
      "surfaced credits_remaining + enrichable_contacts (or otherwise made the paid nature clear) rather than revealing email data that was never requested",
      "did NOT claim it enriched or revealed emails",
    ],
    required_calls: [],
    required_byproducts: [],
    forbidden_calls: ["leadbay_report_outreach"],
  },
};
