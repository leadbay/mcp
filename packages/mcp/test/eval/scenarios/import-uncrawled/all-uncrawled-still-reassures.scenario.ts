// Eval scenario — BOUNDARY guard for issue #3858.
//
// Mirror of the real report: the FULL batch comes back uncrawled (0 immediate
// matches, every row NO_MATCH on a real corporate domain). This is exactly the
// case that spooked the reporter into abandoning the lead set. The agent must
// stay reassuring and actionable — frame the whole batch as pending a
// background crawl and tell the user the added leads will populate in their
// Leadbay account as the crawl completes — and must NOT declare the import a
// failure or blame the websites / the backend.
//
// Authored to the sibling scenario shape (scan-portfolio-signals/*.scenario.ts).

const P = (path: string) => `/1.6${path}`; // LeadbayClient prepends /1.6

const IMPORT_ID = "imp-3858-all-uncrawled";

const importPayload = (opts: { procFinished: boolean }) => ({
  id: IMPORT_ID,
  date: "2026-07-15T00:00:00Z",
  file_name: "mcp-import.csv",
  imported_records: 0,
  pending_imported_records: 4,
  total_records: 4,
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

// Every row NO_MATCH on a real corporate domain → all uncrawled (pending).
const mkRow = (id: number, name: string, website: string) => ({
  id,
  records: [
    { column_name: "LEAD_WEBSITE", value: website },
    { column_name: "LEAD_NAME", value: name },
  ],
  match_type: "NO_MATCH",
  status: "IMPORTING",
  lead: null,
});

const RECORDS_PAGE = {
  items: [
    mkRow(1, "Cortex", "cortex.io"),
    mkRow(2, "Warp", "warp.dev"),
    mkRow(3, "Resend", "resend.com"),
    mkRow(4, "Baseten", "baseten.co"),
  ],
  pagination: { page: 0, pages: 1, total: 4 },
};

// The exact rows the agent must import — same names/domains the RECORDS_PAGE
// fixture returns (all NO_MATCH → uncrawled). Embedded in BOTH the prompt args
// and the user_intent so a wired-up eval agent has real rows to act on (the
// sandboxed session cannot read an attached file).
const IMPORT_ROWS =
  "Cortex (cortex.io), Warp (warp.dev), Resend (resend.com), Baseten (baseten.co)";

export const SCENARIO = {
  name: "import-all-uncrawled-still-reassures",
  prompt: "leadbay_import_file",
  tier: "gate",
  args: {
    instruction: `Import these four companies (name + website): ${IMPORT_ROWS}.`,
  },
  // Same call sequence as leadbay_import_leads (see import-leads.test.ts):
  // users/me → POST /imports → GET /imports/:id → POST update_mappings →
  // GET /imports/:id → GET /imports/:id/records (all rows NO_MATCH → uncrawled).
  backendFixtures: [
    { method: "GET", path: P("/users/me"), status: 200, body: { id: "u-1", email: "milstan@leadbay.ai", admin: true, organization: { id: "org-1", name: "Org" } } },
    { method: "POST", path: /\/1\.6\/imports\?file_name=/, status: 200, body: importPayload({ procFinished: false }) },
    { method: "GET", path: /\/1\.6\/imports\/[^/?]+$/, status: 200, body: importPayload({ procFinished: true }) },
    { method: "POST", path: /\/1\.6\/imports\/[^/]+\/update_mappings/, status: 200, body: { notification_id: "notif-1" } },
    { method: "GET", path: /\/1\.6\/imports\/[^/?]+$/, status: 200, body: importPayload({ procFinished: true }) },
    { method: "GET", path: /\/1\.6\/imports\/[^/]+\/records\?/, status: 200, body: RECORDS_PAGE },
  ],
  mission: {
    user_intent:
      `Import these four companies into Leadbay: ${IMPORT_ROWS}.`,
    success_criteria: [
      "reported all four rows as PENDING a crawl / late-import, not as a failed import",
      "reassured the user the domains are fine and Leadbay will crawl them in the background and add the leads later",
      "told the user the added leads will populate in their Leadbay account as the crawl completes (NOT that leadbay_import_status or any single tool call fetches them) rather than treating the run as a dead end",
      "did NOT say the import failed, was rejected, hit a backend problem, or that the websites are bad/unreachable/invalid",
      "did NOT tell the user to distrust or discard the batch",
    ],
    required_calls: [],
    required_byproducts: [],
    forbidden_calls: ["leadbay_report_outreach"],
  },
};
