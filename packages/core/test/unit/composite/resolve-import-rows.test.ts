import { resetLaunchGuard } from "../../../src/jobs/launch-guard.js";
import { describe, it, expect, beforeEach } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
  getHttpRequests,
} from "../../harness.js";

import { vi } from "vitest";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { resolveImportRows } from "../../../src/composite/resolve-import-rows.js";

const BASE = "https://api-us.leadbay.app";

function newClient() {
  return new LeadbayClient(BASE, "u.test-token", "us");
}

beforeEach(() => {
  resetHttpMock();
  resetLaunchGuard();
});

describe("leadbay_resolve_import_rows", () => {
  it("resolves messy rows and emits import-ready records/mappings", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.6/leads/resolve",
        status: 200,
        body: {
          type: "matched",
          lead_id: "lead-apple",
          matched_on: ["website_exact"],
        },
      },
      {
        method: "POST",
        path: "/1.6/leads/resolve",
        status: 200,
        body: {
          type: "ambiguous",
          candidates: [
            {
              lead_id: "lead-acme-a",
              score: 90,
              matched_on: ["name_exact"],
              lead_fields_populated: ["website"],
            },
            {
              lead_id: "lead-acme-b",
              score: 90,
              matched_on: ["name_exact"],
              lead_fields_populated: ["address"],
            },
          ],
        },
      },
      {
        method: "POST",
        path: "/1.6/leads/resolve",
        status: 200,
        body: { type: "none", would_help: ["website", "registry_number"] },
      },
    ]);

    const out = await resolveImportRows.execute(newClient(), {
      records: [
        { Company: "Apple", Domain: "https://apple.com" },
        { Company: "Acme", City: "Paris" },
        { Company: "Unknown Co" },
      ],
      identity_mappings: { name: "Company", website: "Domain", city: "City" },
    });

    expect(out.summary).toMatchObject({
      total: 3,
      matched: 1,
      ambiguous: 1,
      none: 1,
      unidentifiable: 0,
      ready_for_import: true,
    });
    expect(out.identity_mappings_used).toMatchObject({
      name: "Company",
      website: "Domain",
      city: "City",
    });
    expect(out.rows[0]).toMatchObject({
      index: 0,
      type: "matched",
      lead_id: "lead-apple",
      matched_on: ["website_exact"],
    });
    expect(out.rows[1]).toMatchObject({
      index: 1,
      type: "ambiguous",
      candidates: [{ lead_id: "lead-acme-a" }, { lead_id: "lead-acme-b" }],
    });
    expect(out.records_for_import[0]).toMatchObject({
      Company: "Apple",
      Domain: "https://apple.com",
      LEADBAY_ID: "lead-apple",
    });
    expect(out.records_for_import[1].LEADBAY_ID).toBeUndefined();
    expect(out.mappings_for_import.fields).toMatchObject({
      LEADBAY_ID: "LEADBAY_ID",
      Company: "LEAD_NAME",
      Domain: "LEAD_WEBSITE",
    });
    expect(out.mapping_guidance.join("\n")).toContain("contact-person columns");
    expect(out.disambiguation_policy.join("\n")).toContain("do not choose a candidate from score alone");

    const requests = getHttpRequests();
    expect(JSON.parse(requests[0].body ?? "{}")).toEqual({
      name: "Apple",
      website: "https://apple.com",
    });
    expect(JSON.parse(requests[1].body ?? "{}")).toEqual({
      name: "Acme",
      city: "Paris",
    });
  });

  it("can hydrate ambiguous candidates with lightweight active-lens profiles", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.6/leads/resolve",
        status: 200,
        body: {
          type: "ambiguous",
          candidates: [
            {
              lead_id: "lead-a",
              score: 12,
              matched_on: ["name_exact"],
              lead_fields_populated: ["address"],
            },
            {
              lead_id: "lead-b",
              score: 12,
              matched_on: ["name_exact"],
              lead_fields_populated: ["website"],
            },
          ],
        },
      },
      {
        method: "GET",
        path: "/1.6/users/me",
        status: 200,
        body: {
          id: "u-1",
          organization: { id: "org-1", name: "Org" },
          last_requested_lens: 42,
        },
      },
      {
        method: "GET",
        path: "/1.6/lenses/42/leads/lead-a",
        status: 200,
        body: {
          id: "lead-a",
          name: "Dhaba",
          website: null,
          location: { full: "Queens, NY", city: "New York", country: "US" },
          phone_numbers: [],
          description: "Queens location",
        },
      },
      {
        method: "GET",
        path: "/1.6/lenses/42/leads/lead-b",
        status: 200,
        body: {
          id: "lead-b",
          name: "Dhaba",
          website: "dhabanyc.com",
          location: { full: "108 Lexington Ave, New York, NY", city: "New York", country: "US" },
          phone_numbers: [],
          description: "Lexington Ave location",
        },
      },
    ]);

    const out = await resolveImportRows.execute(newClient(), {
      records: [{ Company: "Dhaba", Domain: "dhabanyc.com" }],
      identity_mappings: { name: "Company", website: "Domain" },
      include_candidate_profiles: true,
    });

    expect(out.rows[0]).toMatchObject({
      type: "ambiguous",
      candidate_profiles: [
        { lead_id: "lead-a", location: { full: "Queens, NY" } },
        { lead_id: "lead-b", website: "dhabanyc.com" },
      ],
    });
  });

  it("honors explicit identity mappings and rejects missing columns", async () => {
    await expect(
      resolveImportRows.execute(newClient(), {
        records: [{ "Account Name": "Stripe" }],
        identity_mappings: { website: "Website" },
      })
    ).rejects.toMatchObject({
      error: true,
      code: "RESOLVE_IMPORT_MAPPING_KEY_UNKNOWN",
    });
    expect(getHttpRequests()).toEqual([]);
  });

  it("supports unidentifiable rows without an import resolver mapping", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.6/leads/resolve",
        status: 200,
        body: { type: "unidentifiable", reason: "no identifying fields supplied" },
      },
    ]);

    const out = await resolveImportRows.execute(newClient(), {
      records: [{ Notes: "met at booth 12" }],
    });

    expect(out.summary).toMatchObject({
      total: 1,
      matched: 0,
      unidentifiable: 1,
      ready_for_import: false,
    });
    expect(out.rows[0]).toMatchObject({
      type: "unidentifiable",
      reason: "no identifying fields supplied",
      resolver_payload: {},
    });
    expect(out.mappings_for_import.fields).toEqual({});
  });
});
