import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  expectAllScriptsConsumed,
  httpsMockFactory,
  mockHttp,
  resetHttpMock,
} from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { campaignCallSheet } from "../../../src/composite/campaign-call-sheet.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

describe("campaign_call_sheet composite", () => {
  it("joins campaign contacts with lead context into call-ready blocks", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.5/campaigns/camp-1/contacts",
        status: 200,
        body: [
          {
            lead_id: "lead-a",
            lead_name: "Peak Performers LLC",
            progress: { total_contacts: 1, in_progress: 1, declined: 0 },
            affiliation: {
              own_campaigns: [{ id: "camp-1", name: "Q2 Push" }],
              other_users_campaign_count: 2,
            },
            contacts: [
              {
                contact: {
                  id: "contact-2",
                  first_name: "Bree",
                  last_name: "Sarlati",
                  email: "bree@example.com",
                  phone_number: "+1 (512) 775-7933",
                  linkedin_page: null,
                  job_title: "CEO",
                  recommended: true,
                  pinned: false,
                  pinned_by_ai: false,
                },
                lead_id: "lead-a",
                recent_notes: [{ note: "Asked for pricing", created_at: "2026-05-01T12:00:00Z" }],
              },
              {
                contact: {
                  id: "contact-1",
                  first_name: "John",
                  last_name: "G.",
                  phone_number: "+1 512-792-7708",
                  linkedin_page: "https://www.linkedin.com/in/johngameztx/",
                  job_title: "Operations Coordinator",
                  recommended: false,
                  pinned: true,
                  pinned_by_ai: true,
                },
                lead_id: "lead-a",
                recent_notes: [],
              },
            ],
          },
          {
            lead_id: "lead-b",
            lead_name: "No Contacts Inc",
            contacts: [],
          },
        ],
      },
      {
        method: "GET",
        path: "/1.5/campaigns/camp-1/leads?count=2&page=1",
        status: 200,
        body: {
          items: [
            {
              lead: {
                id: "lead-b",
                name: "No Contacts Inc",
                score: 55,
                ai_agent_lead_score: null,
                location: { city: "New York", state: "New York", country: "US" },
                phone_numbers: ["+1 212-555-0100"],
                split_ai_summary: { next_step: "Enrich owner title before outreach" },
              },
              progress: { total_contacts: 3, in_progress: 0, declined: 0, headline: null },
              affiliation: { own_campaigns: [], other_users_campaign_count: 0 },
            },
            {
              lead: {
                id: "lead-a",
                name: "Peak Performers LLC",
                score: 72,
                ai_agent_lead_score: 91,
                website: "https://peak.example",
                location: {
                  city: "Austin",
                  state: "Texas",
                  country: "US",
                  full: "Austin, TX, US",
                  pos: [30.3192287, -97.7369031],
                },
                phone_numbers: [],
                split_ai_summary: {
                  next_step: "Call the operations team about staffing gaps",
                  approach_angle: "Rehab staffing",
                  worth_pursuing: "High fit",
                },
              },
              progress: { total_contacts: 1, in_progress: 1, declined: 0, headline: "CONTACTED" },
              affiliation: {
                own_campaigns: [{ id: "other-camp", name: "Austin Sweep" }],
                other_users_campaign_count: 2,
              },
            },
          ],
          pagination: { page: 1, pages: 3, total: 5 },
        },
      },
    ]);

    const result: any = await campaignCallSheet.execute(newClient(), {
      campaign_id: "camp-1",
      count: 2,
      page: 1,
    });

    expect(result.campaign_id).toBe("camp-1");
    expect(result.pagination).toEqual({ page: 1, pages: 3, total: 5 });
    expect(result.leads.map((l: any) => l.lead_id)).toEqual(["lead-a", "lead-b"]);

    const peak = result.leads[0];
    expect(peak.next_step).toBe("Call the operations team about staffing gaps");
    expect(peak.last_action_headline).toBe("CONTACTED");
    expect(peak.contacts.map((c: any) => c.id)).toEqual(["contact-1", "contact-2"]);
    expect(peak.contacts[0].phone_tel_url).toBe("tel:+15127927708");
    expect(peak.contacts[0].linkedin_url_source).toBe("leadbay");
    expect(peak.contacts[1].mailto_url).toBe("mailto:bree@example.com");
    expect(peak.contacts[1].linkedin_url_source).toBe("constructed");
    expect(peak.contacts[1].linkedin_url).toContain("linkedin.com/search/results/people");

    expect(result.map_locations).toEqual([
      {
        name: "Peak Performers LLC",
        address: "Austin, TX, US",
        latitude: 30.3192287,
        longitude: -97.7369031,
        notes: "★ Call the operations team about staffing gaps — call John G., ☎ +1 512-792-7708.",
      },
    ]);
    expect(result.summary).toEqual({
      total_leads: 2,
      total_contacts: 2,
      leads_with_phone: 2,
      leads_with_email: 1,
      leads_with_coords: 1,
      leads_without_contacts: 1,
      leads_already_contacted: 1,
    });
    expect(result.readiness).toEqual({
      ready_for_calling: true,
      ready_for_emailing: false,
      needs_enrichment: true,
      travel_friendly: false,
    });

    expectAllScriptsConsumed();
  });
});
