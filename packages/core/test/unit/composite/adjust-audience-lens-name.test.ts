import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
  getHttpRequests,
} from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { adjustAudience } from "../../../src/composite/adjust-audience.js";

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
// User-level lenses so the apply path is a single POST /lenses/:id/filter.
const LENSES = [
  { id: 4242, name: "Default audience", user_id: "u-1", is_default: false, default: false },
  { id: 99, name: "Joinery audience", user_id: "u-1", is_default: false, default: false },
  { id: 100, name: "Joinery export", user_id: "u-1", is_default: false, default: false },
];
const SECTORS = [
  { id: "1", name: "Fintech" },
  { id: "2", name: "Plomberie" },
];
const EMPTY_FILTER = {
  lens_filter: { items: [{ criteria: [] }] },
  locations: { results: [], parents: [] },
};

beforeEach(() => resetHttpMock());

describe("leadbay_adjust_audience — lensName targeting", () => {
  it("resolves a unique lensName and applies to THAT lens, not the active one", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: ME },
      // resolveLensByName — "Joinery" uniquely substring-matches id 99 over 100? No:
      // both contain "joinery". Use an exact-ish unique query instead.
      { method: "GET", path: "/1.5/lenses", status: 200, body: LENSES },
      { method: "GET", path: "/1.5/sectors/all?lang=en&includeInvisible=false", status: 200, body: SECTORS },
      // target is lens 99 (NOT the active 4242)
      { method: "GET", path: "/1.5/lenses/99", status: 200, body: LENSES[1] },
      { method: "GET", path: "/1.5/lenses/99/filter", status: 200, body: EMPTY_FILTER },
      { method: "POST", path: "/1.5/lenses/99/filter", status: 200, body: {} },
    ]);

    const result: any = await adjustAudience.execute(newClient(), {
      lensName: "Joinery audience", // exact match → id 99
      sectors: ["Fintech"],
    });

    expect(result.status).toBe("applied");
    expect(result.lens_used.id).toBe(99);
    // The active lens (4242) was never written.
    const wrote4242 = getHttpRequests().some(
      (r) => r.method === "POST" && r.path === "/1.5/lenses/4242/filter"
    );
    expect(wrote4242).toBe(false);
  });

  it("unknown lensName → lens_not_found with the lens list, no filter POST", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: ME },
      { method: "GET", path: "/1.5/lenses", status: 200, body: LENSES },
    ]);

    const result: any = await adjustAudience.execute(newClient(), {
      lensName: "Nonexistent",
      sectors: ["Fintech"],
    });

    expect(result.status).toBe("lens_not_found");
    expect(result.lens_query).toBe("Nonexistent");
    expect(result.lenses.map((l: any) => l.id)).toContain(99);
    expect(getHttpRequests().some((r) => r.method === "POST")).toBe(false);
  });

  it("ambiguous lensName (matches >1) → ambiguous_lens with candidates, no POST", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: ME },
      { method: "GET", path: "/1.5/lenses", status: 200, body: LENSES },
    ]);

    const result: any = await adjustAudience.execute(newClient(), {
      lensName: "Joinery", // substring-matches BOTH 99 and 100
      sectors: ["Fintech"],
    });

    expect(result.status).toBe("ambiguous_lens");
    expect(result.matches.map((l: any) => l.id).sort((a: number, b: number) => a - b)).toEqual([99, 100]);
    expect(getHttpRequests().some((r) => r.method === "POST")).toBe(false);
  });

  it("explicit lensId wins over lensName (lensName ignored)", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: ME },
      // lensId short-circuits name resolution → no GET /lenses for name lookup.
      { method: "GET", path: "/1.5/sectors/all?lang=en&includeInvisible=false", status: 200, body: SECTORS },
      { method: "GET", path: "/1.5/lenses/4242", status: 200, body: LENSES[0] },
      { method: "GET", path: "/1.5/lenses/4242/filter", status: 200, body: EMPTY_FILTER },
      { method: "POST", path: "/1.5/lenses/4242/filter", status: 200, body: {} },
    ]);

    const result: any = await adjustAudience.execute(newClient(), {
      lensId: 4242,
      lensName: "Joinery", // ignored because lensId is set
      sectors: ["Fintech"],
    });

    expect(result.status).toBe("applied");
    expect(result.lens_used.id).toBe(4242);
  });

  it("named edit of the DEFAULT lens clones but does NOT switch the active lens", async () => {
    // "edit my Default lens" → can't edit default → clone. But because the user
    // targeted BY NAME (edit-only), the active lens must NOT change: no
    // update_last_requested. (P2 regression)
    const DEFAULT_LENS = { id: 4242, name: "Default audience", is_default: true, default: true };
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: ME },
      { method: "GET", path: "/1.5/lenses", status: 200, body: [DEFAULT_LENS] },
      { method: "GET", path: "/1.5/sectors/all?lang=en&includeInvisible=false", status: 200, body: SECTORS },
      { method: "GET", path: "/1.5/lenses/4242", status: 200, body: DEFAULT_LENS },
      { method: "GET", path: "/1.5/lenses/4242/filter", status: 200, body: EMPTY_FILTER },
      // clone
      { method: "POST", path: "/1.5/lenses", status: 200, body: { id: 5000, name: "Default audience", user_id: "u-1" } },
      // filter applied to the clone
      { method: "POST", path: "/1.5/lenses/5000/filter", status: 200, body: {} },
      // NOTE: deliberately NO update_last_requested mock — if the tool tried it,
      // the harness would throw (no script matched).
    ]);

    const result: any = await adjustAudience.execute(newClient(), {
      lensName: "Default audience",
      sectors: ["Fintech"],
    });

    expect(result.status).toBe("applied");
    expect(result.lens_used.active_lens_changed).toBe(false);
    expect(
      getHttpRequests().some((r) => r.path.includes("update_last_requested"))
    ).toBe(false);
    expect(result.message).toMatch(/active lens is unchanged/i);
  });
});
