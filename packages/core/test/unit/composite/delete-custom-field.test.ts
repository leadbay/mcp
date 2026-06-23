import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, getHttpRequests, httpsMockFactory } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { deleteCustomField } from "../../../src/composite/delete-custom-field.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

const catalog = (rows: unknown[]) => ({
  method: "GET" as const,
  path: "/1.5/crm/custom_fields",
  status: 200,
  body: rows,
});

describe("leadbay_delete_custom_field", () => {
  it("without confirm — previews, does NOT delete", async () => {
    mockHttp([catalog([{ id: "12", name: "Legacy Source", type: "TEXT" }])]);

    const res: any = await deleteCustomField.execute(newClient(), { id: "12" });

    expect(res).toMatchObject({ id: "12", name: "Legacy Source", deleted: false });
    expect(res.hint).toMatch(/confirm:true/);
    // No DELETE fired.
    expect(getHttpRequests().some((r) => r.method === "DELETE")).toBe(false);
  });

  it("with confirm — deletes and reports the removed field", async () => {
    mockHttp([
      catalog([{ id: "12", name: "Legacy Source", type: "TEXT" }]),
      { method: "DELETE", path: /\/1\.5\/crm\/custom_fields\/12$/, status: 204, body: null },
    ]);

    const res: any = await deleteCustomField.execute(newClient(), { id: "12", confirm: true });

    expect(res).toMatchObject({ id: "12", name: "Legacy Source", type: "TEXT", deleted: true });
    expect(getHttpRequests().some((r) => r.method === "DELETE" && /\/crm\/custom_fields\/12$/.test(r.path))).toBe(true);
  });

  it("unknown id — NOT_FOUND, no DELETE", async () => {
    mockHttp([catalog([{ id: "12", name: "Tier", type: "TEXT" }])]);
    await expect(deleteCustomField.execute(newClient(), { id: "999", confirm: true })).rejects.toThrow();
    expect(getHttpRequests().some((r) => r.method === "DELETE")).toBe(false);
  });

  it("missing id — rejects before any HTTP", async () => {
    mockHttp([]);
    await expect(deleteCustomField.execute(newClient(), { id: "" })).rejects.toThrow();
    expect(getHttpRequests()).toHaveLength(0);
  });
});
