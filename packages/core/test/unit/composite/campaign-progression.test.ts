import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  expectAllScriptsConsumed,
  httpsMockFactory,
  mockHttp,
  resetHttpMock,
} from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { campaignProgression } from "../../../src/composite/campaign-progression.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

describe("campaign_progression composite", () => {
  it("counts contacted from outreach signals, not contact coverage", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.5/campaigns/camp-1/leads?count=50&page=0",
        status: 200,
        body: {
          items: [
            {
              lead: { id: "lead-a", name: "Cold but contact-rich" },
              progress: {
                total_contacts: 4,
                in_progress: 0,
                declined: 0,
                headline: null,
              },
              affiliation: { own_campaigns: [], other_users_campaign_count: 0 },
            },
            {
              lead: { id: "lead-b", name: "Reached by call" },
              progress: {
                total_contacts: 1,
                in_progress: 1,
                declined: 0,
                headline: "CONTACTED",
              },
              affiliation: { own_campaigns: [], other_users_campaign_count: 0 },
            },
            {
              lead: { id: "lead-c", name: "Declined" },
              progress: {
                total_contacts: 0,
                in_progress: 0,
                declined: 1,
                headline: null,
              },
              affiliation: { own_campaigns: [], other_users_campaign_count: 0 },
            },
          ],
          pagination: { page: 0, pages: 1, total: 3 },
        },
      },
    ]);

    const result: any = await campaignProgression.execute(newClient(), {
      campaign_id: "camp-1",
    });

    expect(result.summary).toEqual({
      page_size: 3,
      contacted: 2,
      in_progress: 1,
      declined: 1,
    });
    expectAllScriptsConsumed();
  });
});
