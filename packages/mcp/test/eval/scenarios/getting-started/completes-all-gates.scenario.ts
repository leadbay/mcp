// Eval scenario — UNDERDELIVER half of the guided first-run walkthrough
// (issue leadbay/product#3952, "Tool to help people getting started").
//
// The change: a new `leadbay_getting_started` prompt + composite tool ship a
// four-gate walkthrough. Each gate presents ONE way forward plus an exit (two
// options — a lone option is rejected by the host widget and degrades to
// prose), so a brand-new user learns by doing:
//   gate 1  "Check my account"        → leadbay_account_status (no args)
//   gate 2  "Pull today's leads"      → leadbay_pull_leads (no args)
//   gate 3  "Draft the first email"   → leadbay_prepare_outreach (leadId ONLY = free)
//   gate 4  "Find who to email"       → leadbay_enrich_titles (NO titles = free)
//
// Gate 1 doubles as a regression probe: this org's quota_status 401s (a
// brand-new account with no billing plan), so the run also proves the tour
// stays silent about quota and never suggests re-authenticating (WORKFLOWS #30).
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
// job_title but no email/phone, so gate 3's enrichment is the genuine next move.
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
  name: "getting-started-completes-all-gates",
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
    // Gate 1 — a brand-new org with no billing plan yet, so the quota read
    // 401s. leadbay_account_status swallows this into `quota_error`; the tour
    // must then say NOTHING about quota and must NOT suggest re-authenticating.
    // (WORKFLOWS #30 — the product#3761 401-hallucination regression.)
    {
      method: "GET",
      path: P(`/organizations/${ORG_ID}/quota_status`),
      status: 401,
      body: { message: "Unauthorized" },
    },
    // Gate 2 — a non-empty batch, nothing computing. The warming-lens branch is
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
    // Gate 3 — the FREE discovery path only (select → job_titles → preview →
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
    // NO launch fixture: in THIS scenario the user is never asked to pick and
    // never confirms, so the walkthrough must stop at the free preview. A launch
    // here would hit an undeclared endpoint and fail the run — which is exactly
    // the consent guarantee. The consented path is covered by the unit mirror.
  ],
  mission: {
    user_intent: "Walk me through Leadbay.",
    // MULTI-TURN BY NECESSITY. Every gate fires a widget and STOPS to wait for
    // the click — that waiting is the feature. A single-turn scenario therefore
    // never gets past gate 1 and reports "required call never fired", which is
    // the harness measuring the tour working correctly and calling it a
    // failure. Each turn below is the user clicking that gate's forward option.
    turns: [
      {
        prompt: "Walk me through Leadbay.",
        // The opening is prose + the gate-1 widget, and nothing else. Calling a
        // tool here is the "ran the demo at them" failure.
        forbid_calls: ["leadbay_account_status", "leadbay_pull_leads"],
        carry_over: [
          "opened with a SHORT plain-language paragraph — what Leadbay is, what a lens is, what the four steps deliver — and did NOT walk through the four steps one at a time",
          "offered gate 1 and then STOPPED, rather than running the tour at the user",
        ],
      },
      {
        prompt: "Check my account",
        expect_calls: ["leadbay_account_status"],
        carry_over: [
          "reported who the user is signed in as and their organization",
          "said NOTHING about quota, credits, a 401, or any error when the quota read was unavailable — and did NOT tell the user to log in again, re-authenticate, or reconnect",
          "at GATE 1 (the account check) did NOT volunteer which lens is active — WORKFLOWS #31 scopes that rule to the account step; the lens header on gate 2's lead table is the pull_leads rendering doing its job, not a violation",
        ],
      },
      {
        prompt: "Pull today's leads",
        expect_calls: ["leadbay_pull_leads"],
        carry_over: [
          "rendered the batch, or — when the lens was still computing — said so in the user's terms and offered to re-pull, rather than reporting 'no leads found'",
        ],
      },
      {
        prompt: "Draft the first email",
        expect_calls: ["leadbay_prepare_outreach"],
        carry_over: [
          "drafted an email to the top-scoring lead and addressed it to the recommended contact's JOB TITLE — it invented no contact name, because none had been revealed yet",
          "did NOT send the drafted email and did NOT offer to send it",
          "did NOT pass enrich:true — drafting spent nothing",
        ],
      },
      {
        prompt: "Find who to email",
        expect_calls: ["leadbay_enrich_titles"],
        carry_over: [
          "ran the FREE mode:'discover' preview first, scoped to the one lead it drafted for, and said plainly that nothing had been spent yet",
          "told the user the cost BEFORE asking them to confirm, rather than launching the paid reveal off the back of the gate click",
        ],
      },
      {
        prompt: "I'm done for now",
        // The exit is ENDING B: stop line, cheat-sheet, docs link, THEN the 1:1
        // offer. Observed live 2026-08-10: the agent rendered the cheat-sheet,
        // felt finished, and dropped the offer entirely.
        carry_over: [
          "acknowledged the stop without arguing for finishing the tour and without re-firing the gate that was just declined",
          "rendered the keep_going cheat-sheet of what to TYPE next time",
          "offered a 1:1 with Zoe AND included the Calendly link — an exit close without the offer is incomplete",
        ],
      },
    ],
    success_criteria: [
      "walked the gates ONE at a time, waiting for the user between each — did NOT run several steps in a single uninterrupted turn",
      "at gate 3 drafted an email addressed to a job TITLE, inventing no contact name",
      "did NOT send the drafted email or offer to send it",
      "at gate 4 ran the free preview first and stated the cost before asking to confirm",
      "on the exit, closed with the cheat-sheet AND the 1:1 offer with the Calendly link",
      "did NOT reach for another tool to obtain contact details around gate 4's confirm, and claimed no phone or email it had not actually received",
    ],
    required_calls: [
      "leadbay_account_status",
      "leadbay_pull_leads",
      "leadbay_prepare_outreach",
      "leadbay_enrich_titles",
    ],
    required_order: [
      "leadbay_account_status",
      "leadbay_pull_leads",
      "leadbay_prepare_outreach",
      "leadbay_enrich_titles",
    ],
    forbidden_calls: ["leadbay_report_outreach"],
    render_checks: [
      { must_match: "calendly\\.com/zoe-leadbay/demo-leadbay" },
      { must_not_match: "I('ve| have) sent" },
    ],
  },
};
