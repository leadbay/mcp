/**
 * Regression: ambiguous EXCLUDE-location recovery must not invert into an
 * include (issue #3759 review, P2).
 *
 * When an `exclude_locations` entry resolves ambiguously, the recovery message
 * must steer the agent to re-call through `exclude_locations` (the exclude
 * param) — NOT `location_ids` / `locations`, which fold into the INCLUDE set.
 * Routing an excluded pick through the include param silently flips
 * "exclude Springfield" into "include Springfield".
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
} from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { adjustAudience } from "../../../src/composite/adjust-audience.js";
import { newLens } from "../../../src/composite/new-lens.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

const ME = {
  id: "u-1",
  email: "u@example.com",
  organization: { id: "org-1", name: "Acme" },
  admin: false,
  last_requested_lens: 4242,
  language: "en",
};

// Genuinely ambiguous: the query "Spring" prefix-matches several distinct
// names with no exact (score 1.0) winner, so resolveLocations returns it as an
// ambiguity rather than auto-resolving. (Three exact-name "Springfield" rows
// would instead score 1.0 and auto-resolve — not ambiguous.)
const ambiguousSpring = (q: RegExp) => ({
  method: "GET" as const,
  path: q,
  status: 200,
  body: {
    results: [
      { id: "11", country: "US", level: 8, name: "Springfield", parent_ids: [] },
      { id: "22", country: "US", level: 8, name: "Springvale", parent_ids: [] },
      { id: "33", country: "US", level: 8, name: "Springdale", parent_ids: [] },
    ],
    parents: [],
  },
});

beforeEach(() => resetHttpMock());

describe("ambiguous exclude-location recovery preserves exclude intent", () => {
  it("adjust_audience: exclude ambiguity steers to exclude_locations, not location_ids", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: ME },
      ambiguousSpring(/\/1\.5\/geo\/search\?q=Spring/),
    ]);

    const result: any = await adjustAudience.execute(newClient(), {
      exclude_locations: ["Spring"],
    });

    expect(result.status).toBe("ambiguous_locations");
    expect(result.message).toContain("exclude_locations");
    // The exclude branch must explicitly warn off the include param.
    expect(result.message).toMatch(/NOT location_ids/);
    // It must NOT instruct a bare "re-call with location_ids" for the excluded pick.
    expect(result.message).not.toMatch(/matched multiple areas\. Pick from the matches and re-call with location_ids/);
  });

  it("adjust_audience: include ambiguity still steers to location_ids", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: ME },
      ambiguousSpring(/\/1\.5\/geo\/search\?q=Spring/),
    ]);

    const result: any = await adjustAudience.execute(newClient(), {
      locations: ["Spring"],
    });

    expect(result.status).toBe("ambiguous_locations");
    expect(result.message).toContain("location_ids");
    expect(result.message).not.toContain("exclude_locations");
  });

  it("new_lens: exclude ambiguity steers to exclude_locations, not locations", async () => {
    mockHttp([
      ambiguousSpring(/\/1\.5\/geo\/search\?q=Spring/),
    ]);

    const result: any = await newLens.execute(newClient(), {
      name: "ZZ Exclude Amb",
      exclude_locations: ["Spring"],
      base: 42,
      confirm: true,
    });

    expect(result.status).toBe("ambiguous_locations");
    expect(result.message).toContain("exclude_locations");
    expect(result.message).toMatch(/NOT locations/);
  });
});
