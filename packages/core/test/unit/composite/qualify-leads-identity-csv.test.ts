/**
 * product#4131 — on a local install, a finished identity pass also saves
 * every row as a CSV on the user's disk. The hosted server passes no
 * ctx.saveFile, so it writes nothing.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { qualifyLeads } from "../../../src/composite/qualify-leads.js";
import { leadJobStatus } from "../../../src/composite/lead-job-status.js";

const BASE = "https://api-fr.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.tok", "fr");
const JOB_ID = "3f57d723-c99a-4c69-97f9-ac877fe8cf7c";

const ITEMS = [
  {
    ref: { input_indexes: [2], requested_as: { name: "=HYPERLINK(\"x\")" } },
    status: "skipped",
    status_reason: "not_in_universe",
    seq: 0,
  },
  {
    ref: { input_indexes: [0, 3], requested_as: { name: "ADEMIS PATRIMOINE" } },
    status: "delivered",
    seq: 1,
    lead: {
      lead_id: "13d23645-f0d8-40e9-a19f-a02b75768e8e",
      company: {
        name: "ADEMIS PATRIMOINE",
        website: "ademis.com",
        socials: { linkedin: "https://fr.linkedin.com/company/ademis-patrimoine" },
      },
    },
  },
  {
    ref: { input_indexes: [1], requested_as: { name: "CEB COURTAGE, LYON" } },
    status: "delivered",
    seq: 2,
    lead: { lead_id: "5224a8fa-5252-466d-a59c-577953c3efb4", company: { name: "CEB COURTAGE" } },
  },
];

function snapshot(state: string) {
  return {
    job: { id: JOB_ID, state },
    funnel: {},
    items: ITEMS,
    next_since: null,
    cost: { spent: 0, unit: "cost_cents", breakdown: {} },
    explain: { region: "FR", model: "m", scope_notes: [] },
  };
}

function mockJob(state: string) {
  mockHttp([
    {
      method: "POST",
      path: "/1.6/mcp/qualify",
      status: 202,
      body: { job_id: JOB_ID, items_requested: 4, estimated_cost: { max: 0, unit: "cost_cents" } },
    },
    { method: "GET", path: `/1.6/mcp/jobs/${JOB_ID}?limit=100`, status: 200, body: snapshot(state) },
  ]);
}

const refs = [
  { name: "ADEMIS PATRIMOINE" },
  { name: "CEB COURTAGE, LYON" },
  { name: "=HYPERLINK(\"x\")" },
  { name: "ADEMIS PATRIMOINE" },
];

beforeEach(() => resetHttpMock());

describe("identity pass — CSV on a local install", () => {
  it("saves every row in the user's order and returns the path", async () => {
    mockJob("completed");
    const saved: Array<{ name: string; content: string }> = [];
    const saveFile = async (name: string, content: string) => {
      saved.push({ name, content });
      return `/Users/someone/Downloads/${name}`;
    };

    const result: any = await qualifyLeads.execute(
      newClient(),
      { lead_refs: refs, qualify: false, wait_seconds: 0 },
      { saveFile }
    );

    expect(result.file).toBe("/Users/someone/Downloads/leadbay-companies-3f57d723.csv");
    expect(saved).toHaveLength(1);
    expect(saved[0].content.split("\n")).toEqual([
      "row,input,status,reason,company,website,linkedin,lead_id",
      "1;4,ADEMIS PATRIMOINE,delivered,,ADEMIS PATRIMOINE,ademis.com,https://fr.linkedin.com/company/ademis-patrimoine,13d23645-f0d8-40e9-a19f-a02b75768e8e",
      "2,\"CEB COURTAGE, LYON\",delivered,,CEB COURTAGE,,,5224a8fa-5252-466d-a59c-577953c3efb4",
      // The formula guard: a spreadsheet must not run a pasted name.
      "3,\"'=HYPERLINK(\"\"x\"\")\",skipped,not_in_universe,,,,",
      "",
    ]);
  });

  it("writes nothing without ctx.saveFile, which is the hosted server", async () => {
    mockJob("completed");
    const result: any = await qualifyLeads.execute(newClient(), {
      lead_refs: refs,
      qualify: false,
      wait_seconds: 0,
    });
    expect(result.rows).toHaveLength(3);
    expect("file" in result).toBe(false);
  });

  it("writes nothing while the job still runs", async () => {
    mockJob("running");
    const saveFile = vi.fn(async () => "/x.csv");
    const result: any = await qualifyLeads.execute(
      newClient(),
      { lead_refs: refs, qualify: false, wait_seconds: 0 },
      { saveFile }
    );
    expect(saveFile).not.toHaveBeenCalled();
    expect(result.file).toBeUndefined();
  });

  it("a failed write is reported and the rows still come back", async () => {
    mockJob("completed");
    const result: any = await qualifyLeads.execute(
      newClient(),
      { lead_refs: refs, qualify: false, wait_seconds: 0 },
      {
        saveFile: async () => {
          throw new Error("EACCES: permission denied");
        },
      }
    );
    expect(result.file_error).toMatch(/EACCES/);
    expect(result.rows).toHaveLength(3);
  });

  it("leadbay_lead_job_status writes nothing: it is annotated read-only", async () => {
    mockHttp([
      { method: "GET", path: `/1.6/mcp/jobs/${JOB_ID}?limit=100`, status: 200, body: snapshot("completed") },
    ]);
    const saveFile = vi.fn(async (name: string) => `/home/someone/${name}`);
    const result: any = await leadJobStatus.execute(
      newClient(),
      { job_id: JOB_ID, compact: true },
      { saveFile }
    );
    expect(leadJobStatus.annotations?.readOnlyHint).toBe(true);
    expect(saveFile).not.toHaveBeenCalled();
    expect(result.rows).toHaveLength(3);
  });
});
