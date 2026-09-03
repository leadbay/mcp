/**
 * A preprocess timeout in the BACKGROUND import must not park the upload.
 *
 * `commitMappings` (POST /imports/{id}/update_mappings) is the MCP's own call —
 * nothing on the backend sends it. So a chunk we walk away from before that POST
 * sits inert for ever, and `import_status` classifies the row as COMPLETE
 * (pre_processing.finished && !processing): the user is told an import finished
 * that committed nothing.
 *
 * The blocking path already hands such an upload to `resumeParkedUpload`. The
 * `wait_for_completion:false` path did not — its catch only logged. These lock
 * the resume in, and lock in the one case that must NOT resume: a dry run,
 * where committing the mappings would turn a validation pass into a real import.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
  getHttpRequests,
} from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { resetLaunchGuard } from "../../../src/jobs/launch-guard.js";
import { LeadbayClient } from "../../../src/client.js";
import {
  importLeads,
  __setResumeCommitBudgetMsForTests,
} from "../../../src/composite/import-leads.js";

const BASE = "https://api-us.leadbay.app";
const IMPORT_ID = "imp-1";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");
const ME = { id: "u", email: "t@e.com", organization: { id: "org-A" }, admin: true };
const settle = () => new Promise((r) => setTimeout(r, 120));

const row = (finished: boolean) => ({
  id: IMPORT_ID,
  pre_processing: { finished, error: null, hints: null, samples: [] },
  processing: null,
});

const commits = () =>
  getHttpRequests().filter(
    (r) => r.method === "POST" && r.path.endsWith(`/imports/${IMPORT_ID}/update_mappings`)
  );

beforeEach(() => {
  resetHttpMock();
  resetLaunchGuard();
  // The real budget is ten minutes; a ten-minute wait is not a test.
  __setResumeCommitBudgetMsForTests(200);
});

afterEach(() => __setResumeCommitBudgetMsForTests(null));

describe("background import — a parked upload is resumed", () => {
  it("commits the mappings after the background preprocess poll times out", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: ME },
      {
        method: "POST",
        path: /^\/1\.6\/imports\?file_name=/,
        status: 200,
        body: row(false),
      },
      // The background poll: its budget is spent on entry (POLL_INTERVAL_MS is 2s,
      // so a non-zero budget would just sleep past the test), so completeUploadedChunk
      // throws ImportPhaseTimeout("preprocess") after this single read.
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: row(false) },
      // The resume's own poll, on the longer budget: preprocess has landed.
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: row(true) },
      {
        method: "POST",
        path: `/1.6/imports/${IMPORT_ID}/update_mappings`,
        status: 200,
        body: { id: IMPORT_ID },
      },
    ]);

    const res: any = await importLeads.execute(
      newClient(),
      {
        domains: [{ domain: "acme.com" }],
        wait_for_completion: false,
        per_phase_budget_ms: 0,
      },
      {}
    );
    expect(res.importIds).toEqual([IMPORT_ID]);

    await settle();
    await settle();

    // Without the resume this stays 0 and the wizard row never commits.
    expect(commits()).toHaveLength(1);
  });

  it("resumes when preprocess fails for a reason other than the budget", async () => {
    // A transport blip mid-poll is not an ImportPhaseTimeout, but it leaves the
    // chunk exactly as parked. Keying the recovery off the error type missed it.
    mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: ME },
      {
        method: "POST",
        path: /^\/1\.6\/imports\?file_name=/,
        status: 200,
        body: row(false),
      },
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 503, body: { message: "upstream" } },
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: row(true) },
      {
        method: "POST",
        path: `/1.6/imports/${IMPORT_ID}/update_mappings`,
        status: 200,
        body: { id: IMPORT_ID },
      },
    ]);

    await importLeads.execute(
      newClient(),
      { domains: [{ domain: "acme.com" }], wait_for_completion: false },
      {}
    );

    await settle();
    await settle();

    expect(commits()).toHaveLength(1);
  });

  it("never re-sends a commit that already went out", async () => {
    // Preprocess lands, the commit goes out, then the PROCESS poll runs out of
    // budget. The chunk is committed; re-sending it would re-trigger processing.
    mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: ME },
      {
        method: "POST",
        path: /^\/1\.6\/imports\?file_name=/,
        status: 200,
        body: row(false),
      },
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: row(true) },
      {
        method: "POST",
        path: `/1.6/imports/${IMPORT_ID}/update_mappings`,
        status: 200,
        body: { id: IMPORT_ID },
      },
      // pollProcess: `processing` never finishes, and the budget is already spent.
      {
        method: "GET",
        path: `/1.6/imports/${IMPORT_ID}`,
        status: 200,
        body: { ...row(true), processing: { finished: false, progress: 0, error: null } },
      },
    ]);

    await importLeads.execute(
      newClient(),
      {
        domains: [{ domain: "acme.com" }],
        wait_for_completion: false,
        per_phase_budget_ms: 0,
      },
      {}
    );

    await settle();
    await settle();

    expect(commits()).toHaveLength(1);
  });

  it("does NOT resume a dry run — committing it would make it a real import", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: ME },
      {
        method: "POST",
        path: /^\/1\.6\/imports\?file_name=/,
        status: 200,
        body: row(false),
      },
      { method: "GET", path: `/1.6/imports/${IMPORT_ID}`, status: 200, body: row(false) },
    ]);

    await importLeads.execute(
      newClient(),
      {
        domains: [{ domain: "acme.com" }],
        wait_for_completion: false,
        dry_run: true,
        per_phase_budget_ms: 0,
      },
      {}
    );

    await settle();
    await settle();

    expect(commits()).toHaveLength(0);
  });
});
