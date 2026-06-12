// Eval scenario — REGRESSION guard for the sector-creation crash class
// (telemetry 30d ending 2026-06-12: adjust_audience 61% fail, 19 TypeError).
//
// Locks the v0.17.3 fix in packages/core/src/composite/new-lens.ts:
// the POST /lenses body MUST send `base` as a STRING. Lens ids are strings
// server-side ("39107"); a numeric `base` yields 400 "JSON deserialization
// error" and the lens is never created. Pre-fix, "Create a lens called X
// for sector Y" died here. The fix is `base: String(base)` (new-lens.ts:192).
//
// Also locks the POST /lenses/:id/filter body shape: the backend wants the
// UNWRAPPED {items:[...]} body (filterWriteBody), not the {lens_filter,
// locations} envelope.
//
// Authored to the README scenario shape (test/eval/README.md §"Adding a
// scenario"). Fixture-complete; runs once the scenario-execution glue
// (helpers/run-eval.ts, setupScenarioFixtures, runScenarioEval,
// vitest.eval.config.ts) lands — that glue does not exist on this branch
// yet, so there is intentionally no prompts/*.eval.ts wiring file. The
// deterministic red/green proof of these exact fixtures lives in
// packages/core/test/unit/composite/new-lens-string-base-regression.test.ts.

const P = (path: string) => `/1.5${path}`; // LeadbayClient prepends /1.5

const ME = {
  id: "u-1",
  email: "u@example.com",
  organization: { id: "org-1", name: "Acme" },
  language: "en",
  last_requested_lens: 39107,
};

// Taxonomy includes a clean "Fintech" match plus a DIRTY null-name row —
// the same shape that crashed the taxonomy scan before the tokens() guard.
const SECTORS = [
  { id: "1", name: "Fintech" },
  { id: "2", name: null }, // dirty row — must not crash the scan
  { id: "3", name: "Plomberie" },
];

export const SCENARIO = {
  name: "new-lens-string-base",
  prompt: "leadbay_new_lens",
  tier: "gate",
  args: {},
  backendFixtures: [
    // resolveSectors → resolveMe (lang) + /sectors/all
    { method: "GET", path: P("/users/me"), status: 200, body: ME },
    {
      method: "GET",
      path: P("/sectors/all?lang=en&includeInvisible=false"),
      status: 200,
      body: SECTORS,
    },
    // create — the request body `base` must be a STRING (e.g. "39107"),
    // never a number; a numeric base is the 400-deserialization bug. The
    // body-shape assertion itself lives in the unit mirror
    // (new-lens-string-base-regression.test.ts) — the scenario fixture shape
    // is {method,path,status,body} only, so it cannot assert request bodies.
    {
      method: "POST",
      path: P("/lenses"),
      status: 200,
      body: { id: 555, name: "Joinery", user_id: "u-1" },
    },
    // apply filter — the body must be the UNWRAPPED {items:[...]} shape, not
    // the {lens_filter, locations} envelope (asserted in the unit mirror).
    {
      method: "POST",
      path: P("/lenses/555/filter"),
      status: 200,
      body: {},
    },
  ],
  mission: {
    user_intent:
      "Create a lens called Joinery for the fintech sector so I can prospect that audience.",
    success_criteria: [
      "called leadbay_new_lens with confirm:true to actually create the lens",
      "the POST /lenses request sent `base` as a STRING, not a number (numeric base 400s with a JSON deserialization error)",
      "reported the lens was created (status:created) — NOT an API_ERROR / deserialization error",
      "did NOT crash while scanning the sector taxonomy despite a null-name row",
    ],
    required_calls: ["leadbay_new_lens"],
    required_byproducts: [],
    forbidden_calls: ["leadbay_report_outreach"],
  },
};
