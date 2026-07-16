// Eval scenario — UNDERDELIVER / mislabel guard for issue #3858.
//
// A user imported 537 company rows (name + website) via
// leadbay_import_and_qualify; 166 (31%) came back in not_imported with
// reason:"uncrawled". The agent told the user this was "probably a backend
// issue / failed import", so the user distrusted and abandoned the lead set.
//
// milstan's clarification: uncrawled is NOT a failure. The import completes
// immediately; Leadbay then crawls the domain in the background and adds the
// lead asynchronously (a late import). Those rows are PENDING, not errors.
//
// This scenario plants an import (via leadbay_import_leads) where SOME rows
// match immediately and SOME come back NO_MATCH (→ uncrawled) with real
// corporate domains, and asserts the agent frames uncrawled rows as
// pending/late-crawl (the leads populate in the user's Leadbay account as the
// crawl completes; leadbay_import_status only reports progress) and NEVER calls
// them failed / rejected / a backend problem / bad websites.
//
// Authored to the sibling scenario shape (scan-portfolio-signals/*.scenario.ts).

const P = (path: string) => `/1.6${path}`; // LeadbayClient prepends /1.6

const IMPORT_ID = "imp-3858-uncrawled";

// A finished, pre-processed import payload the composite polls to completion.
const importPayload = (opts: { procFinished: boolean }) => ({
  id: IMPORT_ID,
  date: "2026-07-15T00:00:00Z",
  file_name: "mcp-import.csv",
  imported_records: 2,
  pending_imported_records: 3,
  total_records: 5,
  mappings: null,
  pre_processing: {
    finished: true,
    error: null,
    hints: null,
    samples: [],
    status_samples: null,
  },
  processing: {
    progress: opts.procFinished ? 1 : 0,
    finished: opts.procFinished,
    error: null,
  },
});

// Reconciled records: 2 matched immediately, 3 NO_MATCH on real corporate
// domains → the tool labels those uncrawled (pending a background crawl).
const RECORDS_PAGE = {
  items: [
    {
      id: 1,
      records: [
        { column_name: "LEAD_WEBSITE", value: "stripe.com" },
        { column_name: "LEAD_NAME", value: "Stripe" },
      ],
      match_type: "AUTOMATIC_MATCH",
      status: "IMPORTED",
      lead: { id: "lead-stripe", name: "Stripe, Inc.", website: "stripe.com" },
    },
    {
      id: 2,
      records: [
        { column_name: "LEAD_WEBSITE", value: "figma.com" },
        { column_name: "LEAD_NAME", value: "Figma" },
      ],
      match_type: "AUTOMATIC_MATCH",
      status: "IMPORTED",
      lead: { id: "lead-figma", name: "Figma", website: "figma.com" },
    },
    {
      id: 3,
      records: [
        { column_name: "LEAD_WEBSITE", value: "linear.app" },
        { column_name: "LEAD_NAME", value: "Linear" },
      ],
      match_type: "NO_MATCH",
      status: "IMPORTING",
      lead: null,
    },
    {
      id: 4,
      records: [
        { column_name: "LEAD_WEBSITE", value: "vanta.com" },
        { column_name: "LEAD_NAME", value: "Vanta" },
      ],
      match_type: "NO_MATCH",
      status: "IMPORTING",
      lead: null,
    },
    {
      id: 5,
      records: [
        { column_name: "LEAD_WEBSITE", value: "ramp.com" },
        { column_name: "LEAD_NAME", value: "Ramp" },
      ],
      match_type: "NO_MATCH",
      status: "IMPORTING",
      lead: null,
    },
  ],
  pagination: { page: 0, pages: 1, total: 5 },
};

// The exact rows the agent must import — same names/domains the fixtures above
// reconcile (2 matched, 3 NO_MATCH → uncrawled). These are embedded in BOTH the
// prompt args and the user_intent so a wired-up eval agent has real rows to act
// on (the sandboxed session cannot read an attached file).
const IMPORT_ROWS =
  "Stripe (stripe.com), Figma (figma.com), Linear (linear.app), " +
  "Vanta (vanta.com), Ramp (ramp.com)";

export const SCENARIO = {
  name: "import-treats-uncrawled-as-pending",
  prompt: "leadbay_import_file",
  tier: "gate",
  args: {
    instruction: `Import these five companies (name + website): ${IMPORT_ROWS}.`,
  },
  // Fixture the exact call sequence leadbay_import_leads makes (see the working
  // unit test import-leads.test.ts): users/me → POST /imports → GET /imports/:id
  // → POST /imports/:id/update_mappings → GET /imports/:id → GET /imports/:id/records.
  backendFixtures: [
    { method: "GET", path: P("/users/me"), status: 200, body: { id: "u-1", email: "milstan@leadbay.ai", admin: true, organization: { id: "org-1", name: "Org" } } },
    // Create import + first status read.
    { method: "POST", path: /\/1\.6\/imports\?file_name=/, status: 200, body: importPayload({ procFinished: false }) },
    { method: "GET", path: /\/1\.6\/imports\/[^/?]+$/, status: 200, body: importPayload({ procFinished: true }) },
    // Commit the mapping, then poll to processing-done.
    { method: "POST", path: /\/1\.6\/imports\/[^/]+\/update_mappings/, status: 200, body: { notification_id: "notif-1" } },
    { method: "GET", path: /\/1\.6\/imports\/[^/?]+$/, status: 200, body: importPayload({ procFinished: true }) },
    // Reconcile the rows → 2 matched, 3 uncrawled.
    { method: "GET", path: /\/1\.6\/imports\/[^/]+\/records\?/, status: 200, body: RECORDS_PAGE },
  ],
  mission: {
    user_intent:
      `I have five companies (name + website) to import into Leadbay: ${IMPORT_ROWS}. Import them and tell me what happened.`,
    success_criteria: [
      "imported the two matched companies (Stripe, Figma) and reported them as imported",
      "reported Linear, Vanta, and Ramp as PENDING a crawl / late-import — NOT as failed, rejected, errored, or a backend problem",
      "did NOT tell the user the uncrawled websites are bad, unreachable, invalid, or the reason for a failure",
      "explained the uncrawled rows will be crawled in the background and that the leads populate in the user's Leadbay account as the crawl completes — did NOT claim leadbay_import_status returns the added leads",
      "did NOT frame a 3-of-5 uncrawled outcome as the import failing or as a reason to distrust the lead set",
    ],
    required_calls: [],
    required_byproducts: [],
    forbidden_calls: ["leadbay_report_outreach", "leadbay_report_friction"],
  },
};
