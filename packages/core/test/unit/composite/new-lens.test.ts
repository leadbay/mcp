import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
  getHttpRequests,
} from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { newLens } from "../../../src/composite/new-lens.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

const ME = {
  id: "u-1",
  email: "u@example.com",
  organization: { id: "org-1", name: "Acme" },
  language: "en",
  last_requested_lens: 42,
};
const SECTORS = [
  { id: "1", name: "Fintech" },
  { id: "2", name: "Finance services" },
  { id: "3", name: "Plomberie" },
];

beforeEach(() => resetHttpMock());

describe("leadbay_new_lens", () => {
  it("happy path — creates the lens then applies the resolved sector", async () => {
    mockHttp([
      // resolveSectors → resolveMe (lang) + /sectors/all
      { method: "GET", path: "/1.5/users/me", status: 200, body: ME },
      { method: "GET", path: "/1.5/sectors/all?lang=en&includeInvisible=false", status: 200, body: SECTORS },
      // create
      { method: "POST", path: "/1.5/lenses", status: 200, body: { id: 555, name: "Joinery", user_id: "u-1" } },
      // apply filter
      { method: "POST", path: "/1.5/lenses/555/filter", status: 200, body: {} },
    ]);

    const result: any = await newLens.execute(newClient(), {
      name: "Joinery",
      sectors: ["Fintech"],
      base: 42,
      confirm: true,
    });

    expect(result.status).toBe("created");
    expect(result.lens).toEqual({ id: 555, name: "Joinery" });
    // The created lens id appears in the POSTed filter path.
    const filterPost = getHttpRequests().find(
      (r) => r.method === "POST" && r.path === "/1.5/lenses/555/filter"
    );
    expect(filterPost).toBeDefined();
    // The clone POST carried base + name.
    const createPost = getHttpRequests().find(
      (r) => r.method === "POST" && r.path === "/1.5/lenses"
    );
    // base is coerced to a STRING — backend rejects numeric base (400).
    expect(JSON.parse(createPost!.body!)).toMatchObject({ base: "42", name: "Joinery" });
  });

  it("ambiguous sector — lens is NOT created", async () => {
    // "finance" overlaps two sectors equally → ambiguous, so we must bail
    // before POST /lenses (no half-built lens).
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: ME },
      { method: "GET", path: "/1.5/sectors/all?lang=en&includeInvisible=false", status: 200, body: [
        { id: "10", name: "Finance corporate" },
        { id: "11", name: "Finance retail" },
      ] },
    ]);

    const result: any = await newLens.execute(newClient(), {
      name: "Money",
      sectors: ["finance"],
      base: 42,
    });

    expect(result.status).toBe("ambiguous_sectors");
    expect(result.sector_ambiguities[0].sector_text).toBe("finance");
    // Critically: no lens was created.
    expect(
      getHttpRequests().some((r) => r.method === "POST" && r.path === "/1.5/lenses")
    ).toBe(false);
  });

  it("no sectors — bare create, no filter POST", async () => {
    mockHttp([
      // resolveSectors with empty arrays returns early — no /sectors/all hit.
      { method: "POST", path: "/1.5/lenses", status: 200, body: { id: 777, name: "Empty lens", user_id: "u-1" } },
    ]);

    const result: any = await newLens.execute(newClient(), {
      name: "Empty lens",
      base: 42,
      confirm: true,
    });

    expect(result.status).toBe("created");
    expect(result.lens.id).toBe(777);
    // No criteria → no filter POST.
    expect(
      getHttpRequests().some((r) => r.method === "POST" && /\/filter$/.test(r.path))
    ).toBe(false);
  });

  it("explicit base — clones from the given lens, not the default", async () => {
    mockHttp([
      { method: "POST", path: "/1.5/lenses", status: 200, body: { id: 888, name: "From 123", user_id: "u-1" } },
    ]);

    await newLens.execute(newClient(), { name: "From 123", base: 123, confirm: true });

    const createPost = getHttpRequests().find(
      (r) => r.method === "POST" && r.path === "/1.5/lenses"
    );
    expect(JSON.parse(createPost!.body!)).toMatchObject({ base: "123" });
  });

  it("preview — without confirm, returns the plan and creates NOTHING", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: ME },
      { method: "GET", path: "/1.5/sectors/all?lang=en&includeInvisible=false", status: 200, body: SECTORS },
      // No POST mocks — if the tool tried to create, the harness would throw.
    ]);

    const result: any = await newLens.execute(newClient(), {
      name: "Joinery",
      sectors: ["Fintech"],
      sizes: [{ max: 1000 }],
      base: 42,
    });

    expect(result.status).toBe("preview");
    expect(result.will_create.name).toBe("Joinery");
    expect(result.will_create.sectors).toContain("1");
    // Nothing was written.
    expect(getHttpRequests().some((r) => r.method === "POST")).toBe(false);
  });
});
