import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, getHttpRequests, httpsMockFactory } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { updateCustomField } from "../../../src/composite/update-custom-field.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

const catalog = (rows: unknown[]) => ({
  method: "GET" as const,
  path: "/1.5/crm/custom_fields",
  status: 200,
  body: rows,
});

describe("leadbay_update_custom_field", () => {
  it("rename-only — preserves the existing type", async () => {
    mockHttp([
      catalog([{ id: "12", name: "Tier", type: "TEXT" }]),
      { method: "POST", path: /\/1\.5\/crm\/custom_fields\/12$/, status: 204, body: null },
    ]);

    const res: any = await updateCustomField.execute(newClient(), { id: "12", name: "Account Tier" });

    expect(res).toMatchObject({ id: "12", name: "Account Tier", type: "TEXT", mapping_value: "CUSTOM.12" });
    // The POST body merges the rename over the current type.
    const post = getHttpRequests().find((r) => r.method === "POST" && /\/crm\/custom_fields\/12$/.test(r.path));
    expect(JSON.parse(post!.body ?? "{}")).toMatchObject({ name: "Account Tier", type: "TEXT" });
  });

  it("retype to PRICE — keeps name, sends config", async () => {
    mockHttp([
      catalog([{ id: "13", name: "ARR", type: "NUMBER" }]),
      { method: "POST", path: /\/1\.5\/crm\/custom_fields\/13$/, status: 204, body: null },
    ]);

    const res: any = await updateCustomField.execute(newClient(), {
      id: "13",
      type: "PRICE",
      config: { currency: "USD" },
    });

    expect(res).toMatchObject({ id: "13", name: "ARR", type: "PRICE" });
    expect(res.config).toEqual({ currency: "USD" });
  });

  it("no change fields — rejects before any HTTP", async () => {
    mockHttp([]);
    await expect(updateCustomField.execute(newClient(), { id: "12" })).rejects.toThrow();
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("unknown id — NOT_FOUND, no POST", async () => {
    mockHttp([catalog([{ id: "12", name: "Tier", type: "TEXT" }])]);
    await expect(updateCustomField.execute(newClient(), { id: "999", name: "X" })).rejects.toThrow();
    expect(getHttpRequests().some((r) => r.method === "POST")).toBe(false);
  });

  it("EXTERNAL_ID without url_template — rejects before POST", async () => {
    mockHttp([catalog([{ id: "12", name: "Tier", type: "TEXT" }])]);
    await expect(
      updateCustomField.execute(newClient(), { id: "12", type: "EXTERNAL_ID" })
    ).rejects.toThrow();
    expect(getHttpRequests().some((r) => r.method === "POST")).toBe(false);
  });
});
