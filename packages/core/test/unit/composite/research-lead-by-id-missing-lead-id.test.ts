/**
 * Sentry MCP-46 — leadbay_research_lead_by_id called without a leadId.
 *
 * On 14 Sep 2026 an unattended routine on the hosted server (FR, lens 48189)
 * made four such calls in 100 ms. Each one reached the backend as
 * `/lenses/48189/leads/undefined`, alongside POST /interactions and four
 * lead-scoped sub-fetches, and came back as "bad 'leadId' parameter". The
 * same shape hit lens 40923 on 9 Sep and lens 46144 on 31 Aug.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getHttpRequests,
  httpsMockFactory,
  mockHttp,
  resetHttpMock,
} from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { researchLeadById } from "../../../src/composite/research-lead-by-id.js";

const BASE = "https://api-fr.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "fr");

beforeEach(() => resetHttpMock());

describe("leadbay_research_lead_by_id — no leadId (Sentry MCP-46)", () => {
  it("answers INVALID_PARAMS naming leadId and sends nothing to Leadbay", async () => {
    mockHttp([]);
    await expect(
      researchLeadById.execute(newClient(), { lensId: 48189 } as any)
    ).rejects.toMatchObject({
      error: true,
      code: "INVALID_PARAMS",
      message: "leadId is required and must be a non-empty string",
    });
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("treats an empty string the same way, before resolving the lens", async () => {
    mockHttp([]);
    await expect(
      researchLeadById.execute(newClient(), { leadId: "  " })
    ).rejects.toMatchObject({ code: "INVALID_PARAMS" });
    expect(getHttpRequests()).toHaveLength(0);
  });
});
