/**
 * leadbay_enrich_titles over a list longer than one request line (product#4169).
 *
 * /leads/selection/select takes leadIds in the query string, and the API
 * answers 400 "Line exceeds limit of 8192 bytes" past that length. Probed on
 * FR prod 2026-09-17: 180 ids fit, 182 do not. On 2026-09-04 a user asked to
 * "add the emails to this list of prospects", 308 leads, and the first launch
 * failed on the selection. The selection accumulates across calls (probed on
 * FR staging: 29 + 29 → 58, a repeated id is not counted twice), so the tool
 * now selects in batches.
 */

import { resetLaunchGuard } from "../../../src/jobs/launch-guard.js";
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
  expectAllScriptsConsumed,
} from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { enrichTitles } from "../../../src/composite/enrich-titles.js";
import type { ToolContext } from "../../../src/types.js";

const BASE = "https://api-fr.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token");

// The API's limit is on the whole request line: "POST <path> HTTP/1.1".
const REQUEST_LINE_LIMIT = 8192;
const requestLine = (path: string) => `POST ${path} HTTP/1.1`;

const leadIds = Array.from(
  { length: 308 },
  (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`
);

const SELECT = /\/leads\/selection\/select\?/;
const selectOk = { method: "POST", path: SELECT, status: 204 };
const unknownLeads = {
  method: "POST",
  path: SELECT,
  status: 400,
  body: { error: { code: "bad_request", message: "no known leads in 'leadIds'" } },
};

const preview = {
  selected_leads: 308,
  enriched_contacts: 0,
  enrichable_contacts: 412,
  title_suggestions: [],
};

function selectedIds(requests: { path: string }[]) {
  return requests
    .filter((r) => SELECT.test(r.path))
    .flatMap((r) =>
      new URL(`https://x${r.path}`).searchParams.getAll("leadIds")
    );
}

beforeEach(() => {
  resetHttpMock();
  resetLaunchGuard();
});

describe("enrich_titles on a 308-lead list (product#4169)", () => {
  it("selects every lead in request lines the API accepts, then launches once", async () => {
    const { requests } = mockHttp([
      selectOk,
      selectOk,
      selectOk,
      selectOk,
      { method: "GET", path: "/1.6/leads/selection/enrichment/job_titles", status: 200, body: ["Gérant"] },
      { method: "POST", path: "/1.6/leads/selection/enrichment/preview", status: 200, body: preview },
      { method: "POST", path: "/1.6/leads/selection/enrichment/launch", status: 200, body: { notification_id: "n-308" } },
      { method: "POST", path: "/1.6/leads/selection/clear", status: 204 },
    ]);

    const res: any = await enrichTitles.execute(newClient(), {
      leadIds,
      lensId: 1,
      titles: ["Gérant"],
      email: true,
    });

    expect(res.mode).toBe("launched");
    expect(res.notification_id).toBe("n-308");
    const selects = requests.filter((r) => SELECT.test(r.path));
    for (const r of selects) {
      expect(requestLine(r.path).length).toBeLessThanOrEqual(REQUEST_LINE_LIMIT);
    }
    expect(selectedIds(requests)).toEqual(leadIds);
    expect(requests.filter((r) => /enrichment\/launch/.test(r.path))).toHaveLength(1);
    expectAllScriptsConsumed();
  });

  it("re-selects in batches too when the user confirms through the host prompt", async () => {
    const { requests } = mockHttp([
      // preview phase
      selectOk,
      selectOk,
      selectOk,
      selectOk,
      { method: "GET", path: "/1.6/leads/selection/enrichment/job_titles", status: 200, body: ["Gérant"] },
      { method: "POST", path: "/1.6/leads/selection/enrichment/preview", status: 200, body: preview },
      { method: "POST", path: "/1.6/leads/selection/clear", status: 204 },
      { method: "GET", path: "/1.6/users/me", status: 200, body: { id: "u", organization: { id: "o", billing: { ai_credits: 5 } } } },
      // launch phase, after the user accepted
      selectOk,
      selectOk,
      selectOk,
      selectOk,
      { method: "POST", path: "/1.6/leads/selection/enrichment/launch", status: 200, body: { notification_id: "n-308" } },
      { method: "POST", path: "/1.6/leads/selection/clear", status: 204 },
    ]);
    const ctx: ToolContext = {
      elicit: vi.fn(async () => ({ action: "accept" as const, content: { confirm: true } })),
    };

    const res: any = await enrichTitles.execute(
      newClient(),
      { leadIds, lensId: 1, titles: ["Gérant"] },
      ctx
    );

    expect(res.mode).toBe("launched");
    for (const r of requests.filter((r) => SELECT.test(r.path))) {
      expect(requestLine(r.path).length).toBeLessThanOrEqual(REQUEST_LINE_LIMIT);
    }
    expect(selectedIds(requests)).toEqual([...leadIds, ...leadIds]);
    expectAllScriptsConsumed();
  });

  it("a batch of only unknown ids does not fail a call whose other batches selected leads", async () => {
    // One 308-id call used to succeed as long as ANY id was a known lead.
    mockHttp([
      selectOk,
      unknownLeads,
      selectOk,
      selectOk,
      { method: "GET", path: "/1.6/leads/selection/enrichment/job_titles", status: 200, body: ["Gérant"] },
      { method: "POST", path: "/1.6/leads/selection/enrichment/preview", status: 200, body: preview },
      { method: "POST", path: "/1.6/leads/selection/enrichment/launch", status: 200, body: { notification_id: "n-1" } },
      { method: "POST", path: "/1.6/leads/selection/clear", status: 204 },
    ]);

    const res: any = await enrichTitles.execute(newClient(), {
      leadIds,
      lensId: 1,
      titles: ["Gérant"],
      email: true,
    });

    expect(res.mode).toBe("launched");
    expectAllScriptsConsumed();
  });

  it("still answers BAD_INPUT when no batch holds a known lead, and clears the selection", async () => {
    const { requests } = mockHttp([
      unknownLeads,
      unknownLeads,
      unknownLeads,
      unknownLeads,
      { method: "POST", path: "/1.6/leads/selection/clear", status: 204 },
    ]);

    await expect(
      enrichTitles.execute(newClient(), {
        leadIds,
        lensId: 1,
        titles: ["Gérant"],
        email: true,
      })
    ).rejects.toMatchObject({ code: "BAD_INPUT", message: "no known leads in 'leadIds'" });
    expect(requests.filter((r) => /enrichment\//.test(r.path))).toHaveLength(0);
    expectAllScriptsConsumed();
  });

  it("clears what an earlier batch selected when a later batch fails", async () => {
    mockHttp([
      selectOk,
      { method: "POST", path: SELECT, status: 500, body: { message: "boom" } },
      { method: "POST", path: "/1.6/leads/selection/clear", status: 204 },
    ]);

    await expect(
      enrichTitles.execute(newClient(), {
        leadIds,
        lensId: 1,
        titles: ["Gérant"],
        email: true,
      })
    ).rejects.toMatchObject({ code: "API_ERROR" });
    expectAllScriptsConsumed();
  });
});
