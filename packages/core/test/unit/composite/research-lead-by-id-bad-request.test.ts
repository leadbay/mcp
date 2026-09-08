/**
 * product#4085 — leadbay_research_lead_by_id with an 8-character lead id.
 *
 * On 8 Sep 2026 an unattended routine on the hosted server called this tool
 * twenty times in 39 seconds with the first block of each UUID
 * (`/lenses/48110/leads/5585c198`, …). The backend answered every one with
 * `400 bad 'leadId' parameter` in ~30 ms; the tool surfaced API_ERROR + "Try
 * again". The lens-scoped profile fetch is the one sub-request whose failure
 * the composite throws, so the agent must now receive BAD_INPUT naming the
 * parameter, with no client-side retry of the rejected call.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { httpsMockFactory, mockHttp, resetHttpMock } from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { researchLeadById } from "../../../src/composite/research-lead-by-id.js";

const BASE = "https://api-fr.leadbay.app";
const LENS = 48110;
const SHORT_ID = "5585c198"; // first block of a UUID — what the agent actually sent
const newClient = () => new LeadbayClient(BASE, "u.test-token", "fr");

// Every lead-scoped endpoint rejects a non-UUID id the same way (probed on
// api-fr 2026-09-08): the profile fetch AND the five soft-failing sub-fetches.
const BAD_LEAD_ID = { error: { code: "bad_request", message: "bad 'leadId' parameter" } };

function mockIncident() {
  return mockHttp([
    { method: "POST", path: "/1.6/interactions", status: 400, body: BAD_LEAD_ID },
    { method: "GET", path: `/1.6/lenses/${LENS}/leads/${SHORT_ID}`, status: 400, body: BAD_LEAD_ID },
    { method: "GET", path: new RegExp(`^/1\\.6/leads/${SHORT_ID}/`), status: 400, body: BAD_LEAD_ID },
    { method: "GET", path: new RegExp(`^/1\\.6/leads/${SHORT_ID}/`), status: 400, body: BAD_LEAD_ID },
    { method: "GET", path: new RegExp(`^/1\\.6/leads/${SHORT_ID}/`), status: 400, body: BAD_LEAD_ID },
    { method: "GET", path: new RegExp(`^/1\\.6/leads/${SHORT_ID}/`), status: 400, body: BAD_LEAD_ID },
    { method: "GET", path: new RegExp(`^/1\\.6/leads/${SHORT_ID}/`), status: 400, body: BAD_LEAD_ID },
  ]);
}

beforeEach(() => resetHttpMock());

describe("leadbay_research_lead_by_id — a shortened lead id (product#4085)", () => {
  it("surfaces BAD_INPUT with the backend's 'bad leadId' message and the 400", async () => {
    mockIncident();
    await expect(
      researchLeadById.execute(newClient(), { leadId: SHORT_ID, lensId: LENS })
    ).rejects.toMatchObject({
      error: true,
      code: "BAD_INPUT",
      message: "bad 'leadId' parameter",
      _meta: { http_status: 400, endpoint: `/lenses/${LENS}/leads/${SHORT_ID}` },
    });
  });

  it("the hint says the call fails the same way on retry and that ids are full UUIDs", async () => {
    mockIncident();
    let err: any;
    try {
      await researchLeadById.execute(newClient(), { leadId: SHORT_ID, lensId: LENS });
    } catch (e) {
      err = e;
    }
    expect(err?.hint).toContain("will fail the same way");
    expect(err?.hint).toContain("36-character");
    expect(err?.hint).not.toContain("Try again");
  });

  it("sends the rejected profile request exactly once — no client-side retry", async () => {
    const { requests } = mockIncident();
    await researchLeadById
      .execute(newClient(), { leadId: SHORT_ID, lensId: LENS })
      .catch(() => undefined);
    const profileCalls = requests.filter(
      (r) => r.method === "GET" && r.path === `/1.6/lenses/${LENS}/leads/${SHORT_ID}`
    );
    expect(profileCalls).toHaveLength(1);
  });

  it("response_format:'markdown' does not swallow the rejection into an empty card", async () => {
    mockIncident();
    await expect(
      researchLeadById.execute(newClient(), {
        leadId: SHORT_ID,
        lensId: LENS,
        response_format: "markdown",
      })
    ).rejects.toMatchObject({ code: "BAD_INPUT" });
  });
});
