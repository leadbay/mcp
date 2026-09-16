// product#4100 — an exact sector label must beat every label that merely
// contains the word.
//
// This is the issue's own reproduction and it survived the field fix. The
// resolver scored `overlap / caller_word_count` and ignored the label's own
// extra words, so "Construction" scored 1.0 against the label `Construction`
// AND against `Specialized construction work`. The confidence gate then wanted
// a 0.34 lead over the runner-up, which an exact label can never have in a tie
// it is part of, so the call returned `ambiguous_sectors` with the exact label
// sitting at the top of its own list. Measured live on prod, both regions,
// 2026-09-16.
//
// RED proof on main: `resolveSectors` returns an ambiguity and no lens filter
// is written.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory, getHttpRequests } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { adjustAudience } from "../../../src/composite/adjust-audience.js";

const BASE = "https://api-fr.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "fr");

const ME = {
  id: "u-1",
  email: "u@example.com",
  organization: { id: "org-1", name: "Acme" },
  admin: false,
  last_requested_lens: 4242,
  language: "fr",
};
const LENS = { id: 4242, name: "My audience", user_id: "u-1", is_default: false, default: false };
const EMPTY_FILTER = {
  lens_filter: { items: [{ criteria: [] }] },
  locations: { results: [], parents: [] },
};
const SECTORS_PATH = "/1.6/sectors/all?lang=fr&includeInvisible=false";

beforeEach(() => resetHttpMock());

describe("leadbay_adjust_audience — an exact sector label", () => {
  it("wins over every label that merely contains the word", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: ME },
      {
        method: "GET",
        path: SECTORS_PATH,
        status: 200,
        body: [
          { id: "3706", label: "Construction", number_of_leads: 783569 },
          { id: "3820", parent: "3706", label: "Specialized construction work", number_of_leads: 400000 },
          { id: "3821", parent: "3706", label: "Construction of buildings", number_of_leads: 300000 },
        ],
      },
      { method: "GET", path: "/1.6/lenses/4242", status: 200, body: LENS },
      { method: "GET", path: "/1.6/lenses/4242/filter", status: 200, body: EMPTY_FILTER },
      { method: "POST", path: "/1.6/lenses/4242/filter", status: 200, body: {} },
    ]);

    const result: any = await adjustAudience.execute(newClient(), {
      sectors: ["Construction"],
    });

    expect(result.status).toBe("applied");
    // The proof is what was written to the lens: the exact label's id alone,
    // not the descendants that merely carry the word.
    const write = getHttpRequests().find(
      (r) => r.method === "POST" && r.path === "/1.6/lenses/4242/filter"
    );
    expect(JSON.parse(write!.body!).items[0].criteria).toContainEqual(
      expect.objectContaining({ type: "sector_ids", sectors: ["3706"] })
    );
  });
});
