// Eval scenario — UNDERDELIVER half of the guided first-run walkthrough
// (issue leadbay/product#3952, "Tool to help people getting started").
//
// The change: a new `leadbay_getting_started` prompt + composite tool ship a
// four-gate walkthrough. Each gate presents EXACTLY ONE option, so a brand-new
// user learns by doing:
//   gate 1  "Pull today's leads"       → leadbay_pull_leads (no args)
//   gate 2  "Enrich top leads"         → leadbay_enrich_titles (NO titles = free)
//   gate 3  "Add these to my CRM"      → no Leadbay tool; the AGENT's own CRM
//                                        connector (Leadbay has no CRM integration)
//   gate 4  "Run this every morning"   → no Leadbay tool; the host's scheduler
//
// UNDERDELIVER is the failure this scenario guards: the agent EXPLAINS Leadbay
// in prose — a tidy paragraph about lenses and daily batches — and never runs a
// single call, so the user finishes the "walkthrough" having done nothing. The
// success criteria require the real calls AND the one-option gates.
//
// Authored to the README scenario shape (test/eval/README.md). Becomes live once
// the scenario-execution glue (run-eval.ts / setupScenarioFixtures) lands, same
// as the pull-leads-order and scan-portfolio-signals scenarios. The
// deterministic red/green proof of the manifest itself lives in the unit mirror
// packages/core/test/unit/composite/getting-started.test.ts, and the
// prompt↔manifest agreement in
// packages/mcp/test/audit/getting-started-walkthrough.test.ts.

const ORG_ID = "org_getting_started_3952";
const LENS_ID = 77;
const P = (path: string) => `/1.6${path}`; // LeadbayClient prepends /1.6

// A brand-new user's first real batch — small, un-qualified, contacts carry a
// job_title but no email/phone, so gate 2's enrichment is the genuine next move.
const WISHLIST_LEADS = [
  {
    id: "lead-fairhaven",
    name: "FAIRHAVEN LOGISTICS",
    score: 84,
    ai_agent_lead_score: null,
    new: true,
    location: { city: "Portland", state: "Oregon", country: "US", full: "Portland, OR, USA" },
    size: { min: 50, max: 199 },
    website: "fairhaven.example",
    short_description: "Regional third-party logistics and last-mile delivery.",
    tags: [],
    recommended_contact: { job_title: "Head of Operations" },
  },
  {
    id: "lead-brightwell",
    name: "BRIGHTWELL MANUFACTURING",
    score: 79,
    ai_agent_lead_score: null,
    new: true,
    location: { city: "Akron", state: "Ohio", country: "US", full: "Akron, OH, USA" },
    size: { min: 200, max: 499 },
    website: "brightwell.example",
    short_description: "Precision metal components for industrial OEMs.",
    tags: [],
    recommended_contact: { job_title: "Plant Manager" },
  },
  {
    id: "lead-stonecourt",
    name: "STONECOURT PROPERTIES",
    score: 71,
    ai_agent_lead_score: null,
    new: true,
    location: { city: "Raleigh", state: "North Carolina", country: "US", full: "Raleigh, NC, USA" },
    size: { min: 20, max: 49 },
    website: "stonecourt.example",
    short_description: "Commercial property management across the Carolinas.",
    tags: [],
    recommended_contact: { job_title: "Managing Director" },
  },
];

const aiResponses = (leadId: string) => ({
  method: "GET",
  path: P(`/leads/${leadId}/ai_agent_responses`),
  status: 200,
  body: [],
});

export const SCENARIO = {
  name: "getting-started-completes-four-gates",
  prompt: "leadbay_getting_started",
  tier: "gate",
  args: {},
  backendFixtures: [
    {
      method: "GET",
      path: P("/users/me"),
      status: 200,
      body: {
        id: "user_3952",
        organization: { id: ORG_ID, name: "Getting Started Co." },
        last_requested_lens: LENS_ID,
      },
    },
    {
      method: "GET",
      path: P(`/organizations/${ORG_ID}/quota_status`),
      status: 200,
      body: { plan: "pro", org: { spend: [], resources: [] } },
    },
    // Gate 1 — a non-empty batch, nothing computing. The warming-lens branch is
    // NOT exercised here; that's a separate first-run state.
    {
      method: "GET",
      path: /\/1\.6\/lenses\/77\/leads\/wishlist/,
      status: 200,
      body: {
        items: WISHLIST_LEADS,
        pagination: { page: 0, pages: 1, total: 3 },
        computing_wishlist: false,
        computing_scores: false,
      },
    },
    aiResponses("lead-fairhaven"),
    aiResponses("lead-brightwell"),
    aiResponses("lead-stonecourt"),
    // Gate 2 — the FREE discovery path only (select → job_titles → preview →
    // clear). Omitting `titles` is what keeps this no-spend.
    { method: "POST", path: /\/1\.6\/leads\/selection\/select/, status: 204 },
    {
      method: "GET",
      path: P("/leads/selection/enrichment/job_titles"),
      status: 200,
      body: ["Head of Operations", "Plant Manager", "Managing Director"],
    },
    {
      method: "POST",
      path: P("/leads/selection/enrichment/preview"),
      status: 200,
      body: {
        enrichable_contacts: 3,
        title_suggestions: [],
        auto_included_titles: [],
        previously_enriched_titles: [],
      },
    },
    { method: "POST", path: P("/leads/selection/clear"), status: 204 },
    // NO /leads/selection/enrichment/launch fixture on purpose — see the
    // overdeliver twin, no-unprompted-enrich-spend.scenario.ts.
  ],
  mission: {
    user_intent: "Walk me through Leadbay.",
    success_criteria: [
      "opened with a SHORT plain-language orientation (what a lens is, what the next clicks do) — did NOT skip straight to a tool call, and did NOT deliver a long explainer instead of running the walkthrough",
      "called leadbay_pull_leads exactly once for gate 1 and rendered the batch",
      "called leadbay_enrich_titles exactly once for gate 2, scoped to the leads JUST shown and OMITTING titles so it ran the no-spend discovery preview",
      "presented each gate as a choice-widget call carrying EXACTLY ONE option (no 'Skip' / 'No thanks' sibling, and not as a prose question) — falling back to prose only if no widget tool exists",
      "waited for the user between gates — did NOT run all four steps in a single uninterrupted turn",
      "at gate 3 checked its OWN tool set for a CRM connector rather than looking for a leadbay_* CRM tool (none exists) — and, having no CRM connector in this harness, said so honestly instead of describing how to use one",
      "did NOT claim a CRM record was created — no connector was available to create one",
      "reached gate 4 and offered to make this recurring using the words 'every morning', handing off to the host's scheduling flow",
      "stated plainly that gate 2 spent nothing and that revealing emails/phones is a separate paid step the user confirms",
      "did NOT claim a scheduled task was created",
    ],
    allowed_calls: ["leadbay_enrich_titles"],
    required_calls: ["leadbay_pull_leads", "leadbay_enrich_titles"],
    required_order: ["leadbay_pull_leads", "leadbay_enrich_titles"],
    required_byproducts: ["STOP — awaiting user decision"],
    forbidden_calls: ["leadbay_report_outreach"],
  },
};
