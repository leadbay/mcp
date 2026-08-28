import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
  getHttpRequests,
} from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import {
  setLeadStatus,
  SETTABLE_LEAD_STATUSES,
} from "../../../src/tools/set-lead-status.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

describe("leadbay_set_lead_status", () => {
  it("happy path — POSTs set_status per lead", async () => {
    mockHttp([
      { method: "POST", path: "/1.6/leads/lead-1/set_status", status: 204, body: "" },
    ]);

    const result = await setLeadStatus.execute(newClient(), {
      lead_ids: ["lead-1"],
      status: "WON",
    });

    expect(result).toEqual({
      applied: true,
      count: 1,
      status: "WON",
      failed: [],
    });
    const reqs = getHttpRequests();
    expect(reqs).toHaveLength(1);
    expect(reqs[0].path).toBe("/1.6/leads/lead-1/set_status");
    expect(JSON.parse(reqs[0].body as string)).toEqual({ status: "WON" });
  });

  it("lowercase status is canonicalized, no synonyms guessed", async () => {
    mockHttp([
      { method: "POST", path: "/1.6/leads/lead-1/set_status", status: 204, body: "" },
    ]);

    const result = await setLeadStatus.execute(newClient(), {
      lead_ids: ["lead-1"],
      status: "won",
    });

    expect((result as { status: string }).status).toBe("WON");
    expect(JSON.parse(getHttpRequests()[0].body as string)).toEqual({ status: "WON" });
  });

  it("status_date fires the second endpoint after set_status", async () => {
    mockHttp([
      { method: "POST", path: "/1.6/leads/lead-1/set_status", status: 204, body: "" },
      { method: "POST", path: "/1.6/leads/lead-1/set_status_date", status: 204, body: "" },
    ]);

    const result = await setLeadStatus.execute(newClient(), {
      lead_ids: ["lead-1"],
      status: "LOST",
      status_date: "2026-03-14",
    });

    expect(result).toEqual({
      applied: true,
      count: 1,
      status: "LOST",
      status_date: "2026-03-14",
      failed: [],
    });
    const reqs = getHttpRequests();
    expect(reqs.map((r) => r.path)).toEqual([
      "/1.6/leads/lead-1/set_status",
      "/1.6/leads/lead-1/set_status_date",
    ]);
    // The date endpoint's key is `date`, not `status_date` — the two routes do
    // not share a field name (backend OpenAPI: _leads__leadId__set_status_date_post_request).
    // And the value must be a full instant: the backend parses it with
    // Instant.parse, so a bare "2026-03-14" comes back as a JSON
    // deserialization error despite the spec's `format: date`.
    expect(JSON.parse(reqs[1].body as string)).toEqual({ date: "2026-03-14T00:00:00Z" });
  });

  it("omitting status_date makes no second call", async () => {
    mockHttp([
      { method: "POST", path: "/1.6/leads/lead-1/set_status", status: 204, body: "" },
    ]);

    await setLeadStatus.execute(newClient(), { lead_ids: ["lead-1"], status: "WANTED" });

    expect(getHttpRequests()).toHaveLength(1);
  });

  it("a partial failure is reported, not swallowed", async () => {
    mockHttp([
      { method: "POST", path: "/1.6/leads/ok-1/set_status", status: 204, body: "" },
      {
        method: "POST",
        path: "/1.6/leads/bad-1/set_status",
        status: 404,
        body: { message: "lead not found" },
      },
    ]);

    const result = (await setLeadStatus.execute(newClient(), {
      lead_ids: ["ok-1", "bad-1"],
      status: "WON",
    })) as { applied: boolean; count: number; failed: Array<{ lead_id: string }> };

    expect(result.applied).toBe(true);
    expect(result.count).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].lead_id).toBe("bad-1");
  });

  it("every lead failing yields applied:false", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.6/leads/bad-1/set_status",
        status: 500,
        body: { message: "boom" },
      },
    ]);

    const result = (await setLeadStatus.execute(newClient(), {
      lead_ids: ["bad-1"],
      status: "WON",
    })) as { applied: boolean; count: number; failed: unknown[] };

    expect(result.applied).toBe(false);
    expect(result.count).toBe(0);
    expect(result.failed).toHaveLength(1);
  });

  it("a failed set_status skips that lead's set_status_date", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.6/leads/bad-1/set_status",
        status: 500,
        body: { message: "boom" },
      },
    ]);

    await setLeadStatus.execute(newClient(), {
      lead_ids: ["bad-1"],
      status: "WON",
      status_date: "2026-01-02",
    });

    // Only the set_status attempt — never a date stamp for a status that
    // did not land.
    expect(getHttpRequests().map((r) => r.path)).toEqual(["/1.6/leads/bad-1/set_status"]);
  });

  it("unknown status is rejected before any HTTP call", async () => {
    mockHttp([]);

    const result = (await setLeadStatus.execute(newClient(), {
      lead_ids: ["lead-1"],
      status: "closed-won",
    })) as { error: boolean; code: string };

    expect(result.error).toBe(true);
    expect(result.code).toBe("BAD_INPUT");
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("malformed status_date is rejected before any HTTP call", async () => {
    mockHttp([]);

    const result = (await setLeadStatus.execute(newClient(), {
      lead_ids: ["lead-1"],
      status: "WON",
      status_date: "14/03/2026",
    })) as { error: boolean; code: string };

    expect(result.error).toBe(true);
    expect(result.code).toBe("BAD_INPUT");
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("empty lead_ids makes no HTTP call", async () => {
    mockHttp([]);

    const result = (await setLeadStatus.execute(newClient(), {
      lead_ids: [],
      status: "WON",
    })) as { error: boolean; code: string };

    expect(result.error).toBe(true);
    expect(result.code).toBe("BAD_INPUT");
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("over the 200-lead cap is rejected before any HTTP call", async () => {
    mockHttp([]);

    const result = (await setLeadStatus.execute(newClient(), {
      lead_ids: Array.from({ length: 201 }, (_, i) => `lead-${i}`),
      status: "WON",
    })) as { error: boolean; code: string };

    expect(result.error).toBe(true);
    expect(result.code).toBe("BAD_INPUT");
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("lead ids are URL-encoded into the path", async () => {
    mockHttp([
      { method: "POST", path: "/1.6/leads/a%2Fb/set_status", status: 204, body: "" },
    ]);

    await setLeadStatus.execute(newClient(), { lead_ids: ["a/b"], status: "WON" });

    expect(getHttpRequests()[0].path).toBe("/1.6/leads/a%2Fb/set_status");
  });

  it("exposes exactly the four human-settable statuses", () => {
    expect([...SETTABLE_LEAD_STATUSES]).toEqual(["WANTED", "WON", "LOST", "UNWANTED"]);
  });

  it("is a write tool and is not read-only", () => {
    expect(setLeadStatus.write).toBe(true);
    expect(setLeadStatus.annotations?.readOnlyHint).toBe(false);
  });
});
