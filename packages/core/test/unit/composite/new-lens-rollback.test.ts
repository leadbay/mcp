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
  last_requested_lens: "42",
};
const SECTORS = [{ id: "1", name: "Fintech" }];

beforeEach(() => resetHttpMock());

// P2: a failed filter write must not leave an orphan lens with no criteria.
describe("leadbay_new_lens — rollback on filter failure", () => {
  it("filter write fails → DELETEs the new lens and rethrows", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: ME },
      { method: "GET", path: "/1.5/sectors/all?lang=en&includeInvisible=false", status: 200, body: SECTORS },
      { method: "POST", path: "/1.5/lenses", status: 200, body: { id: "555", name: "Joinery", user_id: "u-1" } },
      // filter write fails
      { method: "POST", path: "/1.5/lenses/555/filter", status: 500, body: { error: "boom" } },
      // rollback delete succeeds
      { method: "DELETE", path: "/1.5/lenses/555", status: 204, body: {} },
    ]);

    await expect(
      newLens.execute(newClient(), { name: "Joinery", sectors: ["Fintech"], base: 42, confirm: true })
    ).rejects.toThrow();

    // The orphan was cleaned up.
    expect(
      getHttpRequests().some((r) => r.method === "DELETE" && r.path === "/1.5/lenses/555")
    ).toBe(true);
  });

  it("filter write fails AND cleanup fails → returns orphan_created", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: ME },
      { method: "GET", path: "/1.5/sectors/all?lang=en&includeInvisible=false", status: 200, body: SECTORS },
      { method: "POST", path: "/1.5/lenses", status: 200, body: { id: "555", name: "Joinery", user_id: "u-1" } },
      { method: "POST", path: "/1.5/lenses/555/filter", status: 500, body: { error: "boom" } },
      { method: "DELETE", path: "/1.5/lenses/555", status: 500, body: { error: "nope" } },
    ]);

    const result: any = await newLens.execute(newClient(), {
      name: "Joinery",
      sectors: ["Fintech"],
      base: 42,
      confirm: true,
    });

    expect(result.status).toBe("orphan_created");
    expect(result.lens).toEqual({ id: "555", name: "Joinery" });
    expect(result.message).toContain("555");
  });
});
