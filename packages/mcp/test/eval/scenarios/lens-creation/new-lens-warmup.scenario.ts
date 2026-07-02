// Eval scenario — REGRESSION guard for issue #3833 ("New Lens problem"):
// a freshly-created lens reads EMPTY on the first pull while the backend is
// still (re)computing its wishlist, and the agent wrongly reports "no leads."
//
// Root cause (confirmed against leadbay/backend + a live probe): POST
// /lenses/:id/filter queues a RefreshLens job (computing_wishlist=true); the
// wishlist recomputes asynchronously. The MCP's leadbay_pull_leads did a
// one-shot fetch, got items:[], and — because buildPullLeadsNextSteps returned
// null on an empty page — surfaced no widget, so the agent said "empty."
//
// The fix (this PR):
//   - leadbay_new_lens `created` result carries computing_wishlist:true + a
//     "leads stream in ~30s" message when the lens has criteria.
//   - leadbay_pull_leads emits a single "Re-pull in ~30s" next-step
//     (kind:repull_computing) when the page is empty AND a computing flag is set.
//
// Like new-lens-string-base.scenario.ts, this is fixture-complete but the
// scenario-execution glue (setupScenarioFixtures / runScenarioEval /
// prompts/*.eval.ts) does not exist on this branch yet — the deterministic
// red/green proof of these behaviours lives in the unit mirrors:
//   packages/core/test/unit/composite/new-lens-computing.test.ts
//   packages/core/test/unit/composite/pull-leads-computing-next-steps.test.ts

const P = (path: string) => `/1.6${path}`; // LeadbayClient prepends /1.6

const ME = {
  id: "u-1",
  email: "u@example.com",
  organization: { id: "org-1", name: "Acme" },
  language: "en",
  last_requested_lens: 40445,
};

const SECTORS = [
  { id: "1", name: "Fintech" },
  { id: "2", name: null }, // dirty row — must not crash the taxonomy scan
  { id: "3", name: "Plomberie" },
];

// First pull after create: wishlist still computing → empty page + the flag.
// (The eval fixture layer serves one canned response per path; the "settles to
// N leads after ~30s" transition is asserted in the live probe, not here.)
const WISHLIST_COMPUTING = {
  items: [],
  pagination: { page: 0, pages: 0, total: 0 },
  computing_wishlist: true,
  computing_scores: true,
};

export const SCENARIO = {
  name: "new-lens-warmup",
  // leadbay_new_lens is a TOOL, not a prompt; the intent enters through the
  // args-less orientation prompt and is driven by mission.user_intent (mirrors
  // new-lens-string-base.scenario.ts).
  prompt: "leadbay_prospecting_overview",
  tier: "gate",
  args: {},
  backendFixtures: [
    { method: "GET", path: P("/users/me"), status: 200, body: ME },
    {
      method: "GET",
      path: P("/sectors/all?lang=en&includeInvisible=false"),
      status: 200,
      body: SECTORS,
    },
    {
      method: "POST",
      path: P("/lenses"),
      status: 200,
      body: { id: 556, name: "Warmup", user_id: "u-1" },
    },
    { method: "POST", path: P("/lenses/556/filter"), status: 200, body: {} },
    // The first pull hits a still-computing, empty wishlist.
    {
      method: "GET",
      path: P("/lenses/556/leads/wishlist?count=20&page=0&contacts=true"),
      status: 200,
      body: WISHLIST_COMPUTING,
    },
  ],
  mission: {
    user_intent:
      "Create a lens called Warmup for the fintech sector and show me the leads.",
    success_criteria: [
      "called leadbay_new_lens with confirm:true to actually create the lens",
      "UNDERDELIVER GUARD: did NOT report the new lens as empty / 'no leads found' as a terminal answer",
      "surfaced that the lens is still computing / warming up and offered to re-pull in ~30s (rendered from the pull_leads next_steps widget, or from new_lens computing_wishlist)",
      "OVERDELIVER GUARD: did NOT fabricate a populated lead table for the empty computing response",
      "OVERDELIVER GUARD: did NOT hammer leadbay_pull_leads in a tight retry loop (offered a wait/re-pull instead of firing many immediate pulls)",
    ],
    required_calls: ["leadbay_new_lens"],
    required_byproducts: [],
    // The agent must not treat the empty-while-computing page as a final "empty
    // lens" result.
    forbidden_calls: ["leadbay_report_outreach"],
  },
};
