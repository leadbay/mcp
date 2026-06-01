import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
  getHttpRequests,
  createLogger,
} from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { adjustAudience } from "../../../src/composite/adjust-audience.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

// User-level lens (user_id set, not default) → apply path is a single
// POST /lenses/:id/filter, the simplest mutation branch.
const ME = {
  id: "u-1",
  email: "u@example.com",
  organization: { id: "org-1", name: "Acme" },
  admin: false,
  last_requested_lens: 4242,
  language: "fr",
};
const LENS = {
  id: 4242,
  name: "My audience",
  user_id: "u-1",
  is_default: false,
  default: false,
};
const EMPTY_FILTER = {
  lens_filter: { items: [{ criteria: [] }] },
  locations: { results: [], parents: [] },
};

const SECTORS_PATH =
  "/1.5/sectors/all?lang=fr&includeInvisible=false";

beforeEach(() => resetHttpMock());

describe("leadbay_adjust_audience", () => {
  it("regression — a null/missing-name taxonomy entry does not crash", async () => {
    // Pre-fix this threw "Cannot read properties of undefined (reading
    // 'toLowerCase')" while scanning the taxonomy, regardless of the clean input.
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: ME },
      {
        method: "GET",
        path: SECTORS_PATH,
        status: 200,
        body: [
          { id: "1", name: "Menuiserie" },
          { id: "2", name: null }, // dirty entry — used to crash the whole call
          { id: "3" }, // missing name entirely
        ],
      },
      { method: "GET", path: "/1.5/lenses/4242", status: 200, body: LENS },
      {
        method: "GET",
        path: "/1.5/lenses/4242/filter",
        status: 200,
        body: EMPTY_FILTER,
      },
      {
        method: "POST",
        path: "/1.5/lenses/4242/filter",
        status: 200,
        body: {},
      },
    ]);

    const result: any = await adjustAudience.execute(newClient(), {
      sectors: ["Menuiserie"],
    });

    expect(result.status).toBe("applied");
    // The single clean sector resolved to its id and was merged into the filter.
    const criteria = result.filter_applied.lens_filter.items[0].criteria;
    const inc = criteria.find(
      (c: any) => c.type === "sector_ids" && !c.is_excluded
    );
    expect(inc.sectors).toContain("1");
  });

  it("logs a warning when the taxonomy carries null-name sectors", async () => {
    const { logger, logs } = createLogger();
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: ME },
      {
        method: "GET",
        path: SECTORS_PATH,
        status: 200,
        body: [
          { id: "1", name: "Menuiserie" },
          { id: "2", name: null },
        ],
      },
      { method: "GET", path: "/1.5/lenses/4242", status: 200, body: LENS },
      {
        method: "GET",
        path: "/1.5/lenses/4242/filter",
        status: 200,
        body: EMPTY_FILTER,
      },
      { method: "POST", path: "/1.5/lenses/4242/filter", status: 200, body: {} },
    ]);

    await adjustAudience.execute(
      newClient(),
      { sectors: ["Menuiserie"] },
      { logger }
    );

    expect(
      logs.some(
        (l) => l.level === "warn" && /null\/missing name/.test(l.msg)
      )
    ).toBe(true);
  });

  it("no-match — surfaces a clear 'couldn't find' message, not 'matched multiple'", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: ME },
      {
        method: "GET",
        path: SECTORS_PATH,
        status: 200,
        body: [
          { id: "1", name: "Menuiserie" },
          { id: "2", name: "Plomberie" },
        ],
      },
    ]);

    const result: any = await adjustAudience.execute(newClient(), {
      sectors: ["carport"], // no token overlap with any taxonomy entry
    });

    expect(result.status).toBe("ambiguous_sectors");
    const entry = result.sector_ambiguities.find(
      (a: any) => a.sector_text === "carport"
    );
    expect(entry).toBeDefined();
    expect(entry.matches).toHaveLength(0);
    expect(result.message).toMatch(/couldn't find/i);
    expect(result.message).toContain("carport");
  });

  it("ambiguous — multiple close matches → 'pick from the matches' message", async () => {
    // "bois" overlaps two distinct multi-word sectors equally → no confident pick.
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: ME },
      {
        method: "GET",
        path: SECTORS_PATH,
        status: 200,
        body: [
          { id: "10", name: "Travail du bois" },
          { id: "11", name: "Commerce du bois" },
        ],
      },
    ]);

    const result: any = await adjustAudience.execute(newClient(), {
      sectors: ["bois"],
    });

    expect(result.status).toBe("ambiguous_sectors");
    const entry = result.sector_ambiguities.find(
      (a: any) => a.sector_text === "bois"
    );
    expect(entry.matches.length).toBeGreaterThanOrEqual(2);
    expect(result.message).toMatch(/matched multiple sectors/i);
    expect(result.message).toMatch(/sector_ids/);
  });

  it("happy path — confident single match resolves and applies to the lens", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: ME },
      {
        method: "GET",
        path: SECTORS_PATH,
        status: 200,
        body: [
          { id: "1", name: "Menuiserie" },
          { id: "2", name: "Plomberie" },
        ],
      },
      { method: "GET", path: "/1.5/lenses/4242", status: 200, body: LENS },
      {
        method: "GET",
        path: "/1.5/lenses/4242/filter",
        status: 200,
        body: EMPTY_FILTER,
      },
      { method: "POST", path: "/1.5/lenses/4242/filter", status: 200, body: {} },
    ]);

    const result: any = await adjustAudience.execute(newClient(), {
      sectors: ["Menuiserie"],
    });

    expect(result.status).toBe("applied");
    expect(result.lens_used.id).toBe(4242);
    // A POST to the lens filter actually happened.
    const posted = getHttpRequests().find(
      (r) => r.method === "POST" && r.path === "/1.5/lenses/4242/filter"
    );
    expect(posted).toBeDefined();
  });
});
