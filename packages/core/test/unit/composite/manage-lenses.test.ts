import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
  getHttpRequests,
} from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { myLenses } from "../../../src/composite/manage-lenses.js";

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
  { id: "4242", name: "Default audience", description: "All sectors", is_last_active: true, default: true },
  { id: "99", name: "Joinery", description: null, is_last_active: false, default: false },
];

beforeEach(() => resetHttpMock());

describe("leadbay_manage_lenses", () => {
  it("list — marks the active lens from /me.last_requested_lens (string ids)", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/lenses", status: 200, body: LENSES },
      { method: "GET", path: "/1.6/users/me", status: 200, body: ME("4242") },
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
      { method: "GET", path: "/1.6/lenses", status: 200, body: LENSES },
      { method: "GET", path: "/1.6/users/me", status: 200, body: ME("4242") },
      { method: "POST", path: "/1.6/lenses/99/update_last_requested", status: 200, body: {} },
      {
        method: "GET",
        path: "/1.6/lenses",
        status: 200,
        body: [{ ...LENSES[0], is_last_active: false }, { ...LENSES[1], is_last_active: true }],
      },
      { method: "GET", path: "/1.6/users/me", status: 200, body: ME("99") },
    ]);

    const result: any = await myLenses.execute(newClient(), { switchToLensId: 99 });

    expect(result.status).toBe("switched");
    expect(result.switched).toBe(true);
    expect(result.active_lens_id).toBe("99");
    expect(result.lenses.find((l: any) => l.id === "99").is_active).toBe(true);
    expect(
      getHttpRequests().some(
        (r) => r.method === "POST" && r.path === "/1.6/lenses/99/update_last_requested"
      )
    ).toBe(true);
  });

  it("edit — name + description in one POST, returns the refreshed list", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/lenses", status: 200, body: LENSES },
      { method: "GET", path: "/1.6/users/me", status: 200, body: ME("4242") },
      { method: "POST", path: "/1.6/lenses/99", status: 200, body: {} },
      {
        method: "GET",
        path: "/1.6/lenses",
        status: 200,
        body: [LENSES[0], { ...LENSES[1], name: "Joinery Pro", description: "Woodworking <1000" }],
      },
      { method: "GET", path: "/1.6/users/me", status: 200, body: ME("4242") },
    ]);

    const result: any = await myLenses.execute(newClient(), {
      editLensId: "99",
      newName: "Joinery Pro",
      newDescription: "Woodworking <1000",
    });

    expect(result.status).toBe("edited");
    expect(result.edited).toBe(true);
    const row = result.lenses.find((l: any) => l.id === "99");
    expect(row.name).toBe("Joinery Pro");
    expect(row.description).toBe("Woodworking <1000");
    const post = getHttpRequests().find(
      (r) => r.method === "POST" && r.path === "/1.6/lenses/99"
    );
    expect(JSON.parse(post!.body!)).toEqual({ name: "Joinery Pro", description: "Woodworking <1000" });
  });

  it("edit — description only (no rename) sends just description", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/lenses", status: 200, body: LENSES },
      { method: "GET", path: "/1.6/users/me", status: 200, body: ME("4242") },
      { method: "POST", path: "/1.6/lenses/99", status: 200, body: {} },
      { method: "GET", path: "/1.6/lenses", status: 200, body: LENSES },
      { method: "GET", path: "/1.6/users/me", status: 200, body: ME("4242") },
    ]);

    await myLenses.execute(newClient(), { editLensId: "99", newDescription: "Just a note" });

    const post = getHttpRequests().find(
      (r) => r.method === "POST" && r.path === "/1.6/lenses/99"
    );
    expect(JSON.parse(post!.body!)).toEqual({ description: "Just a note" });
  });

  it("edit — nothing to change → not_found, no POST", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/lenses", status: 200, body: LENSES },
      { method: "GET", path: "/1.6/users/me", status: 200, body: ME("4242") },
    ]);

    const result: any = await myLenses.execute(newClient(), { editLensId: "99" });

    expect(result.status).toBe("not_found");
    expect(getHttpRequests().some((r) => r.method === "POST")).toBe(false);
  });

  it("switch — unknown id returns not_found and does NOT POST", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/lenses", status: 200, body: LENSES },
      { method: "GET", path: "/1.6/users/me", status: 200, body: ME("4242") },
    ]);

    const result: any = await myLenses.execute(newClient(), { switchToLensId: "777" });

    expect(result.status).toBe("not_found");
    expect(result.switched).toBe(false);
    expect(result.active_lens_id).toBe("4242");
    expect(result.message).toContain("777");
    expect(getHttpRequests().some((r) => r.method === "POST")).toBe(false);
  });

  it("delete — without confirm returns delete_preview, removes NOTHING", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/lenses", status: 200, body: LENSES },
      { method: "GET", path: "/1.6/users/me", status: 200, body: ME("4242") },
      // No DELETE mock — if it tried to delete, the harness would throw.
    ]);

    const result: any = await myLenses.execute(newClient(), { deleteLensId: "99" });

    expect(result.status).toBe("delete_preview");
    expect(result.will_delete).toEqual({ id: "99", name: "Joinery" });
    expect(getHttpRequests().some((r) => r.method === "DELETE")).toBe(false);
  });

  it("delete — with confirm DELETEs and returns the refreshed list", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/lenses", status: 200, body: LENSES },
      { method: "GET", path: "/1.6/users/me", status: 200, body: ME("4242") },
      { method: "DELETE", path: "/1.6/lenses/99", status: 204, body: {} },
      { method: "GET", path: "/1.6/lenses", status: 200, body: [LENSES[0]] },
      { method: "GET", path: "/1.6/users/me", status: 200, body: ME("4242") },
    ]);

    const result: any = await myLenses.execute(newClient(), {
      deleteLensId: "99",
      confirm: true,
    });

    expect(result.status).toBe("deleted");
    expect(result.deleted).toBe(true);
    expect(result.lenses.find((l: any) => l.id === "99")).toBeUndefined();
    expect(
      getHttpRequests().some((r) => r.method === "DELETE" && r.path === "/1.6/lenses/99")
    ).toBe(true);
  });

  it("delete — default lens is refused (cannot_delete_default), no DELETE", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/lenses", status: 200, body: LENSES },
      { method: "GET", path: "/1.6/users/me", status: 200, body: ME("4242") },
    ]);

    const result: any = await myLenses.execute(newClient(), {
      deleteLensId: "4242",
      confirm: true,
    });

    expect(result.status).toBe("cannot_delete_default");
    expect(getHttpRequests().some((r) => r.method === "DELETE")).toBe(false);
  });

  it("list — empty lens set does not crash", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/lenses", status: 200, body: [] },
      { method: "GET", path: "/1.6/users/me", status: 200, body: ME(null) },
    ]);

    const result: any = await myLenses.execute(newClient(), {});

    expect(result.status).toBe("listed");
    expect(result.lenses).toHaveLength(0);
    expect(result.active_lens_id).toBeNull();
  });
});
