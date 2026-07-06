// Eval scenario — CONSENT-STILL-WORKS companion to product#3848.
//
// The #3848 fix must not over-correct: when the user EXPLICITLY authorizes the
// spend ("go ahead and spend, enrich their emails"), leadbay_enrich_titles must
// still launch the paid enrichment. This mirrors WORKFLOWS.md Workflow 34
// turn 2 ("go ahead and spend, email + phone, up to 10 contacts").
//
// This scenario provides the /leads/selection/enrichment/launch fixture and
// asserts the agent surfaces credits + volume, then launches with an explicit
// channel — the consent path is preserved.
//
// Fixture-complete; the scenario-execution glue does not exist on this branch
// yet (same as the sibling scenario). The deterministic red/green proof of the
// consent path lives in the unit mirror
// packages/core/test/unit/composite/enrich-titles-consent-gate.test.ts
// ("explicit email:true → launches", "confirm:true → launches").

const ORG_ID = "org_enrich_3848_consent";
const LENS_ID = 89;
const P = (path: string) => `/1.6${path}`; // LeadbayClient prepends /1.6

const LEAD_A = "lead-a-consent";
const LEAD_B = "lead-b-consent";

export const SCENARIO = {
  name: "enrich-titles-explicit-spend-launches",
  prompt: "leadbay_prospecting_overview",
  tier: "gate",
  args: {},
  backendFixtures: [
    {
      method: "GET",
      path: P("/users/me"),
      status: 200,
      body: {
        id: "user_3848c",
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
        enrichable_contacts: 8,
        title_suggestions: [],
        auto_included_titles: [],
        previously_enriched_titles: [],
      },
    },
    // Explicit consent → the launch is expected and provided.
    {
      method: "POST",
      path: P("/leads/selection/enrichment/launch"),
      status: 204,
    },
    { method: "POST", path: P("/leads/selection/clear"), status: 204 },
  ],
  mission: {
    user_intent:
      `Go ahead and spend — enrich the emails for these contacts: ${LEAD_A}, ${LEAD_B}. ` +
      `I've got credits, get me their email addresses.`,
    success_criteria: [
      "launched the paid email enrichment via leadbay_enrich_titles after the explicit spend authorization",
      "did NOT block or refuse the launch, and did NOT run an extra confirmation/preview loop first — explicit up-front consent ('go ahead and spend') launches directly in one call",
      "did NOT fabricate email addresses (enrichment runs async; results come from a later status poll, not invented inline)",
    ],
    // Single declared path: explicit consent → one enrich_titles launch
    // (select → job_titles → preview → launch → clear). No separate pre-launch
    // preview round-trip is required or fixtured — surfacing the balance BEFORE
    // spend is the UNCONFIRMED path's job (see titles-linkedin-only-no-spend),
    // not this one, where the user already authorized the spend.
    required_calls: ["leadbay_enrich_titles"],
    required_byproducts: [],
    forbidden_calls: ["leadbay_report_outreach"],
  },
};
