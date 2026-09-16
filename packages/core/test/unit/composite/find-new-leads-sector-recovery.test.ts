// product#4140 — a scheduled agent's run must not die on a sector label.
//
// `julien@lelab0.com` runs "Identifier & importer 10 nouveaux prospects
// qualifiés Pipedrive" unattended around 06:00 UTC on weekdays. The second call
// of every run sent `filters.sectors: ["Professional Services"]` and came back
// 400 BAD_INPUT, because the API matches that field as an exact, case-sensitive
// label. The agent re-reads the tool description on every run, so the refusal
// never taught it anything and the same call failed again the next morning
// (2026-09-12, 09-14, 09-15 in production telemetry).
//
// RED proof on main: the first case throws BAD_INPUT instead of returning a
// choice, and the second throws instead of searching.

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
  getHttpRequests,
} from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { findNewLeads } from "../../../src/composite/find-new-leads.js";

const BASE = "https://api-fr.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "fr");

const ME = {
  id: "u-1",
  email: "julien@lelab0.com",
  organization: { id: "org-1", name: "Le Lab" },
  admin: false,
  language: "en",
};

const SECTORS_PATH = "/1.6/sectors/all?lang=en&includeInvisible=false";
const SEARCH = "/1.6/mcp/search";

/** Real SIRENE rows, trimmed, as api-fr served them on 2026-09-15. */
const TAXONOMY = [
  { id: "3706", label: "Construction", number_of_leads: 783569 },
  { id: "3712", label: "Real estate activities", number_of_leads: 2561592 },
  { id: "3713", label: "Specialized, scientific, and technical activities", number_of_leads: 840992 },
  { id: "3714", label: "Administrative and support service activities", number_of_leads: 565425 },
  { id: "3719", label: "Other service activities", number_of_leads: 836546 },
  { id: "4090", parent: "3712", label: "Real estate agencies", number_of_leads: 120000 },
];

/** The exact envelope the API returns for an unresolvable sector. */
const sectorRejection = {
  method: "POST" as const,
  path: SEARCH,
  status: 400,
  body: {
    error: {
      code: "bad_request",
      message: "filters.sectors value could not be resolved: Professional Services",
    },
  },
};

const JULIEN = {
  count: 5,
  filters: {
    sectors: ["Professional Services"],
    employees_min: 8,
    employees_max: 40,
  },
  dry_run: true,
  request_id: "identifier-10-nouveaux-prospects-2026-09-15",
};

beforeEach(() => resetHttpMock());

describe("leadbay_find_new_leads — a sector label the API does not carry", () => {
  it("answers with the sectors to choose from instead of a 400 that says do not retry", async () => {
    mockHttp([
      sectorRejection,
      { method: "GET", path: "/1.6/users/me", status: 200, body: ME },
      { method: "GET", path: SECTORS_PATH, status: 200, body: TAXONOMY },
    ]);

    // THE LOAD-BEARING ASSERTION: the run continues. On main this rejects.
    const result: any = await findNewLeads.execute(newClient(), JULIEN as any);

    expect(result.mode).toBe("needs_sector_choice");
    expect(result.submitted).toBe(false);
    expect(result.unresolved_sectors).toEqual([
      { asked: "Professional Services", closest: expect.any(Array) },
    ]);
    // The label a French workspace actually wants for this ask is a section.
    expect(result.sector_sections).toContain(
      "Specialized, scientific, and technical activities"
    );
    expect(result.hint).toContain("Nothing was submitted");
  });

  it("does not submit a second time once the sectors are unusable", async () => {
    mockHttp([
      sectorRejection,
      { method: "GET", path: "/1.6/users/me", status: 200, body: ME },
      { method: "GET", path: SECTORS_PATH, status: 200, body: TAXONOMY },
    ]);

    await findNewLeads.execute(newClient(), JULIEN as any);

    const submits = getHttpRequests().filter((r) => r.method === "POST" && r.path === SEARCH);
    expect(submits).toHaveLength(1);
  });

  it("a paid ask reaches the choice before the user is asked to approve spend", async () => {
    mockHttp([
      sectorRejection,
      { method: "GET", path: "/1.6/users/me", status: 200, body: ME },
      { method: "GET", path: SECTORS_PATH, status: 200, body: TAXONOMY },
    ]);

    const result: any = await findNewLeads.execute(newClient(), {
      count: 5,
      filters: { sectors: ["Professional Services"] },
      qualify: true,
      channels: ["email"],
      request_id: "paid-4140",
    } as any);

    expect(result.mode).toBe("needs_sector_choice");
    expect(result.submitted).toBe(false);
    // Not a quote the user could say yes to — the sector was never real.
    expect(result.estimated_cost).toBeUndefined();
  });
});

describe("leadbay_find_new_leads — a sector label that is only spelled differently", () => {
  it("fixes the spelling, searches, and says which sector ran", async () => {
    mockHttp([
      {
        method: "POST",
        path: SEARCH,
        status: 400,
        body: {
          error: {
            code: "bad_request",
            message: "filters.sectors value could not be resolved: construction",
          },
        },
      },
      { method: "GET", path: "/1.6/users/me", status: 200, body: ME },
      { method: "GET", path: SECTORS_PATH, status: 200, body: TAXONOMY },
      {
        method: "POST",
        path: SEARCH,
        status: 200,
        body: { valid: true, items_requested: 5, estimated_cost: { max: 0, unit: "cost_cents" } },
      },
    ]);

    const result: any = await findNewLeads.execute(newClient(), {
      count: 5,
      filters: { sectors: ["construction", "real estate"] },
      dry_run: true,
      request_id: "spelling-4140",
    } as any);

    expect(result.dry_run).toBe(true);
    expect(result.valid).toBe(true);
    expect(result.sectors_used).toEqual([
      { asked: "construction", used: "Construction" },
      { asked: "real estate", used: "Real estate activities" },
    ]);

    const submits = getHttpRequests().filter((r) => r.method === "POST" && r.path === SEARCH);
    expect(submits).toHaveLength(2);
    expect(JSON.parse(submits[1].body!).filters.sectors).toEqual([
      "Construction",
      "Real estate activities",
    ]);
    // Same ask, same idempotency key — the retry must not launch a second job.
    expect(JSON.parse(submits[1].body!).request_id).toBe("spelling-4140");
  });
});

describe("leadbay_find_new_leads — everything else is left alone", () => {
  it("a sector the API accepts costs no extra call", async () => {
    mockHttp([
      {
        method: "POST",
        path: SEARCH,
        status: 200,
        body: { valid: true, items_requested: 5 },
      },
    ]);

    const result: any = await findNewLeads.execute(newClient(), {
      count: 5,
      filters: { sectors: ["Construction"] },
      dry_run: true,
      request_id: "happy-4140",
    } as any);

    expect(result.valid).toBe(true);
    expect(result.sectors_used).toBeUndefined();
    // No /me, no taxonomy: the happy path is untouched.
    expect(getHttpRequests()).toHaveLength(1);
  });

  it("a 400 about another field still propagates as a 400", async () => {
    mockHttp([
      {
        method: "POST",
        path: SEARCH,
        status: 400,
        body: { error: { code: "bad_request", message: "at most 10 contact_titles" } },
      },
    ]);

    await expect(
      findNewLeads.execute(newClient(), {
        count: 5,
        filters: { sectors: ["Construction"] },
        dry_run: true,
        request_id: "other-400",
      } as any)
    ).rejects.toMatchObject({ code: "BAD_INPUT" });
  });

  it("a taxonomy id that does not exist still propagates — there is nothing to offer", async () => {
    mockHttp([
      {
        method: "POST",
        path: SEARCH,
        status: 400,
        body: {
          error: {
            code: "bad_request",
            message: "filters.sectors value could not be resolved: 999999999",
          },
        },
      },
      { method: "GET", path: "/1.6/users/me", status: 200, body: ME },
      { method: "GET", path: SECTORS_PATH, status: 200, body: TAXONOMY },
    ]);

    await expect(
      findNewLeads.execute(newClient(), {
        count: 5,
        filters: { sectors: ["999999999"] },
        dry_run: true,
        request_id: "dead-id",
      } as any)
    ).rejects.toMatchObject({ code: "BAD_INPUT" });
  });

  it("a sector 400 on a call that passed no sectors still propagates", async () => {
    mockHttp([
      {
        method: "POST",
        path: SEARCH,
        status: 400,
        body: {
          error: {
            code: "bad_request",
            message: "filters.sectors value could not be resolved: 99999",
          },
        },
      },
    ]);

    await expect(
      findNewLeads.execute(newClient(), {
        count: 5,
        query: "gyms",
        dry_run: true,
        request_id: "no-sectors",
      } as any)
    ).rejects.toMatchObject({ code: "BAD_INPUT" });
  });
});
