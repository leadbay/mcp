// Eval scenario — ORDER-FIDELITY guard for issue #3832.
//
// A user reported the MCP returned "today's top leads" in a DIFFERENT order
// than the Leadbay UI's Discover tab. Root cause: the wishlist endpoint
// already returns leads in the UI's canonical order (backend LeadSort.DEFAULT:
// NEW_TODAY DESC, STATUS ASC, SCORE DESC), but the pull_leads RENDERING block
// used to tell the agent to re-sort the table by `score` descending — which
// discards the NEW_TODAY / STATUS primary keys and reorders the rows away from
// the UI. The fix: render the table IN THE ORDER THE TOOL RETURNS IT.
//
// This scenario plants a wishlist whose order is deliberately NOT score-desc:
// a brand-new lead with a LOWER score sits ABOVE an older lead with a HIGHER
// score (exactly what LeadSort.DEFAULT produces). It asserts the agent renders
// the rows in the returned order (new lead first) and does NOT re-sort by score
// (which would float the higher-score older lead to the top and reintroduce the
// bug). If the two orders were identical the scenario couldn't tell the fixed
// behaviour from the broken one — the score/new-today inversion is the whole
// point.
//
// Authored to the README scenario shape (test/eval/README.md). Becomes live
// once the scenario-execution glue (run-eval.ts / setupScenarioFixtures) lands,
// same as the scan-portfolio-signals scenarios.

const ORG_ID = "org_order_3832";
const LENS_ID = 71;
const P = (path: string) => `/1.6${path}`; // LeadbayClient prepends /1.6

// Returned in LeadSort.DEFAULT order (NEW_TODAY DESC, STATUS ASC, SCORE DESC).
// AVILINE is new-today with the LOWER score; it MUST render first because it is
// new — NOT last, which is where a naive score-desc re-sort would push it.
// A score-desc re-sort would produce: BRIDGEWELL(88) → CALDERA(74) → AVILINE(61).
// The correct (tool-order) render is:   AVILINE(61)   → BRIDGEWELL(88) → CALDERA(74).
const WISHLIST_LEADS = [
  {
    id: "lead-aviline",
    name: "AVILINE",
    score: 61,
    ai_agent_lead_score: null,
    new: true,
    location: { city: "Lyon", state: "Auvergne-Rhône-Alpes", country: "FR", full: "Lyon, France" },
    size: { min: 50, max: 99 },
    website: "aviline.io",
    short_description: "B2B logistics SaaS — freight visibility platform.",
    tags: [],
    recommended_contact: null,
  },
  {
    id: "lead-bridgewell",
    name: "BRIDGEWELL",
    score: 88,
    ai_agent_lead_score: null,
    new: false,
    location: { city: "Paris", state: "Île-de-France", country: "FR", full: "Paris, France" },
    size: { min: 200, max: 249 },
    website: "bridgewell.com",
    short_description: "Enterprise payments infrastructure for marketplaces.",
    tags: [],
    recommended_contact: null,
  },
  {
    id: "lead-caldera",
    name: "CALDERA",
    score: 74,
    ai_agent_lead_score: null,
    new: false,
    location: { city: "Nantes", state: "Pays de la Loire", country: "FR", full: "Nantes, France" },
    size: { min: 10, max: 19 },
    website: "caldera.dev",
    short_description: "Developer-tooling startup — CI/CD analytics.",
    tags: [],
    recommended_contact: null,
  },
];

const aiResponses = (leadId) => ({
  method: "GET",
  path: P(`/leads/${leadId}/ai_agent_responses`),
  status: 200,
  body: [],
});

export const SCENARIO = {
  name: "pull-leads-renders-in-tool-order",
  prompt: "leadbay_daily_check_in",
  tier: "gate",
  args: {},
  backendFixtures: [
    { method: "GET", path: P("/users/me"), status: 200, body: {
      id: "user_3832",
      organization: { id: ORG_ID, name: "Order Fidelity Co." },
      last_requested_lens: LENS_ID,
    } },
    { method: "GET", path: P(`/organizations/${ORG_ID}/quota_status`), status: 200, body: {
      plan: "pro",
      org: { spend: [], resources: [] },
    } },
    {
      method: "GET",
      path: /\/1\.6\/lenses\/71\/leads\/wishlist/,
      status: 200,
      body: {
        items: WISHLIST_LEADS,
        pagination: { page: 0, pages: 1, total: 3 },
        computing_wishlist: false,
        computing_scores: false,
      },
    },
    aiResponses("lead-aviline"),
    aiResponses("lead-bridgewell"),
    aiResponses("lead-caldera"),
  ],
  mission: {
    user_intent:
      "Show me my top leads for today — the same list I'd see in the Leadbay Discover tab.",
    success_criteria: [
      "called leadbay_pull_leads exactly once to get today's Discover batch",
      "rendered the leads in the EXACT order the tool returned them: AVILINE first, then BRIDGEWELL, then CALDERA",
      "did NOT re-sort the table by score (a score-desc re-sort would wrongly put BRIDGEWELL first and AVILINE last)",
      "kept AVILINE ahead of the higher-scored leads because it is the new-today lead — matching the UI's Discover order",
      "did NOT print the raw numeric score in the table",
    ],
    required_calls: ["leadbay_pull_leads"],
    required_byproducts: [],
    forbidden_calls: ["leadbay_report_outreach"],
  },
};
