import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
  getHttpRequests,
} from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { myLenses } from "../../../src/composite/my-lenses.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

// Backend returns STRING ids and string last_requested_lens.
const ME = (lastRequested: string | null) => ({
  id: "u-1",
  email: "u@example.com",
  organization: { id: "org-1", name: "Acme" },
  last_requested_lens: lastRequested,
});

const LENSES = [
  { id: "4242", name: "Default audience", description: "All sectors", is_last_active: true },
  { id: "99", name: "Joinery", description: null, is_last_active: false },
];

beforeEach(() => resetHttpMock());

describe("leadbay_my_lenses", () => {
  it("list — marks the active lens from /me.last_requested_lens (string ids)", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/lenses", status: 200, body: LENSES },
      { method: "GET", path: "/1.5/users/me", status: 200, body: ME("4242") },
    ]);

    const result: any = await myLenses.execute(newClient(), {});

    expect(result.status).toBe("listed");
    expect(result.active_lens_id).toBe("4242");
    expect(result.lenses.find((l: any) => l.id === "4242").is_active).toBe(true);
    expect(result.lenses.find((l: any) => l.id === "99").is_active).toBe(false);
  });

  it("switch — NUMERIC param resolves against STRING ids (regression)", async () => {
    // The bug: switchToLensId:99 (number) vs lens id "99" (string) →
    // "99" === 99 is false → falsely "not_found". Must resolve now.
    mockHttp([
      { method: "GET", path: "/1.5/lenses", status: 200, body: LENSES },
      { method: "GET", path: "/1.5/users/me", status: 200, body: ME("4242") },
      { method: "POST", path: "/1.5/lenses/99/update_last_requested", status: 200, body: {} },
      {
        method: "GET",
        path: "/1.5/lenses",
        status: 200,
        body: [{ ...LENSES[0], is_last_active: false }, { ...LENSES[1], is_last_active: true }],
      },
      { method: "GET", path: "/1.5/users/me", status: 200, body: ME("99") },
    ]);

    const result: any = await myLenses.execute(newClient(), { switchToLensId: 99 });

    expect(result.status).toBe("switched");
    expect(result.switched).toBe(true);
    expect(result.active_lens_id).toBe("99");
    expect(result.lenses.find((l: any) => l.id === "99").is_active).toBe(true);
    expect(
      getHttpRequests().some(
        (r) => r.method === "POST" && r.path === "/1.5/lenses/99/update_last_requested"
      )
    ).toBe(true);
  });

  it("rename — POSTs the new name and returns the refreshed list", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/lenses", status: 200, body: LENSES },
      { method: "GET", path: "/1.5/users/me", status: 200, body: ME("4242") },
      { method: "POST", path: "/1.5/lenses/99", status: 200, body: {} },
      {
        method: "GET",
        path: "/1.5/lenses",
        status: 200,
        body: [LENSES[0], { ...LENSES[1], name: "Joinery Pro" }],
      },
      { method: "GET", path: "/1.5/users/me", status: 200, body: ME("4242") },
    ]);

    const result: any = await myLenses.execute(newClient(), {
      renameLensId: "99",
      newName: "Joinery Pro",
    });

    expect(result.status).toBe("renamed");
    expect(result.renamed).toBe(true);
    expect(result.lenses.find((l: any) => l.id === "99").name).toBe("Joinery Pro");
    const post = getHttpRequests().find(
      (r) => r.method === "POST" && r.path === "/1.5/lenses/99"
    );
    expect(JSON.parse(post!.body!)).toMatchObject({ name: "Joinery Pro" });
  });

  it("rename — missing newName → not_found, no POST", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/lenses", status: 200, body: LENSES },
      { method: "GET", path: "/1.5/users/me", status: 200, body: ME("4242") },
    ]);

    const result: any = await myLenses.execute(newClient(), { renameLensId: "99" });

    expect(result.status).toBe("not_found");
    expect(getHttpRequests().some((r) => r.method === "POST")).toBe(false);
  });

  it("switch — unknown id returns not_found and does NOT POST", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/lenses", status: 200, body: LENSES },
      { method: "GET", path: "/1.5/users/me", status: 200, body: ME("4242") },
    ]);

    const result: any = await myLenses.execute(newClient(), { switchToLensId: "777" });

    expect(result.status).toBe("not_found");
    expect(result.switched).toBe(false);
    expect(result.active_lens_id).toBe("4242");
    expect(result.message).toContain("777");
    expect(getHttpRequests().some((r) => r.method === "POST")).toBe(false);
  });

  it("list — empty lens set does not crash", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/lenses", status: 200, body: [] },
      { method: "GET", path: "/1.5/users/me", status: 200, body: ME(null) },
    ]);

    const result: any = await myLenses.execute(newClient(), {});

    expect(result.status).toBe("listed");
    expect(result.lenses).toHaveLength(0);
    expect(result.active_lens_id).toBeNull();
  });
});
