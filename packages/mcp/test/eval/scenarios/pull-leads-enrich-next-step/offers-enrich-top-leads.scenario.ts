// Eval scenario — the "Enrich top leads" NEXT STEPS offer after a pull_leads
// (issue leadbay/product#3875, "On pull leads propose to enrich titles").
//
// The change: after a pull_leads on a non-empty batch, the deterministic
// next_steps object now carries an `enrich_top_leads` option at position 2
// (right after the "Triage board" artifact offer). It routes to
// leadbay_enrich_titles via the NO-SPEND preview path — reveal decision-maker
// email/phone on the top leads, but preview the volume + channels first and
// spend nothing until the user confirms.
//
// This scenario is the underdeliver / overdeliver pair for that offer:
//   UNDERDELIVER — the agent finishes the pull and never surfaces the enrich
//     move, so the user has to think to ask. The success criteria require the
//     offer to appear among the surfaced next steps.
//   OVERDELIVER  — the agent treats "Enrich top leads" as a licence to launch a
//     PAID reveal immediately. No /leads/selection/enrichment/launch fixture is
//     provided on purpose: a silent launch hits an undeclared endpoint and fails
//     the run. The user only asked to see leads — enrichment must stay a
//     preview/offer, never an unprompted spend (WORKFLOWS.md #42 consent gate).
//
// Authored to the README scenario shape (test/eval/README.md). Becomes live once
// the scenario-execution glue (run-eval.ts / setupScenarioFixtures) lands, same
// as the pull-leads-order and scan-portfolio-signals scenarios. The
// deterministic red/green proof of the offer itself lives in the unit mirror
// packages/core/test/unit/composite/pull-leads-enrich-next-step.test.ts.

const ORG_ID = "org_enrich_3875";
const LENS_ID = 91;
const P = (path: string) => `/1.6${path}`; // LeadbayClient prepends /1.6

// A plain, non-empty batch — exactly the case where the enrich offer should
// fire. Contacts carry job_title (FREE on the record) but NO email/phone, so
// enrichment is the genuine next move toward outreach.
const WISHLIST_LEADS = [
  {
    id: "lead-northwind",
    name: "NORTHWIND",
    score: 82,
    ai_agent_lead_score: null,
    new: true,
    location: { city: "Austin", state: "Texas", country: "US", full: "Austin, TX, USA" },
    size: { min: 50, max: 199 },
    website: "northwind.example",
    short_description: "Field-service scheduling SaaS for HVAC installers.",
    tags: [],
    recommended_contact: { job_title: "VP of Operations" },
  },
  {
    id: "lead-cascadia",
    name: "CASCADIA",
    score: 77,
    ai_agent_lead_score: null,
    new: false,
    location: { city: "Denver", state: "Colorado", country: "US", full: "Denver, CO, USA" },
    size: { min: 200, max: 499 },
    website: "cascadia.example",
    short_description: "Regional commercial roofing group.",
    tags: [],
    recommended_contact: { job_title: "Owner" },
  },
];

const aiResponses = (leadId: string) => ({
  method: "GET",
  path: P(`/leads/${leadId}/ai_agent_responses`),
  status: 200,
  body: [],
});

export const SCENARIO = {
  name: "pull-leads-offers-enrich-top-leads",
  prompt: "leadbay_daily_check_in",
  tier: "gate",
  args: {},
  backendFixtures: [
    {
      method: "GET",
      path: P("/users/me"),
      status: 200,
      body: {
        id: "user_3875",
        organization: { id: ORG_ID, name: "Enrich Next-Step Co." },
        last_requested_lens: LENS_ID,
      },
    },
    {
      method: "GET",
      path: P(`/organizations/${ORG_ID}/quota_status`),
      status: 200,
      body: { plan: "pro", org: { spend: [], resources: [] } },
    },
    {
      method: "GET",
      path: /\/1\.6\/lenses\/91\/leads\/wishlist/,
      status: 200,
      body: {
        items: WISHLIST_LEADS,
        pagination: { page: 0, pages: 1, total: 2 },
        computing_wishlist: false,
        computing_scores: false,
      },
    },
    aiResponses("lead-northwind"),
    aiResponses("lead-cascadia"),
    // If the agent RIGHTLY previews enrichment (dry_run/no-spend), the selection
    // lifecycle + preview are fixtured so the preview succeeds without spending.
    { method: "POST", path: /\/1\.6\/leads\/selection\/select/, status: 204 },
    {
      method: "GET",
      path: P("/leads/selection/enrichment/job_titles"),
      status: 200,
      body: ["VP of Operations", "Owner"],
    },
    {
      method: "POST",
      path: P("/leads/selection/enrichment/preview"),
      status: 200,
      body: {
        enrichable_contacts: 2,
        title_suggestions: [],
        auto_included_titles: [],
        previously_enriched_titles: [],
      },
    },
    { method: "POST", path: P("/leads/selection/clear"), status: 204 },
    // NO /leads/selection/enrichment/launch fixture on purpose: an unprompted
    // paid reveal would hit an undeclared endpoint and fail the run.
  ],
  mission: {
    user_intent: "Show me my top leads for today.",
    success_criteria: [
      "called leadbay_pull_leads exactly once to get today's batch",
      "surfaced an 'Enrich top leads' next step among the offered options (reveal decision-maker email/phone on the top leads) — did NOT finish without offering the enrichment move",
      "if it acted on the enrich option, it scoped enrichment to the leads JUST shown (passed the visible leads[].id, not the tool's default page-0 candidate set) and OMITTED titles so it ran the no-spend discovery preview — not a paid launch",
      "did NOT silently launch a paid enrichment — the user only asked to see leads, so it did NOT POST /leads/selection/enrichment/launch",
      "did NOT claim it enriched or revealed any emails/phones",
    ],
    // The no-spend preview path is allowed (select → job_titles → preview →
    // clear). A launch is neither allowed nor fixtured.
    allowed_calls: ["leadbay_enrich_titles"],
    required_calls: ["leadbay_pull_leads"],
    required_byproducts: [],
    forbidden_calls: ["leadbay_report_outreach"],
  },
};
