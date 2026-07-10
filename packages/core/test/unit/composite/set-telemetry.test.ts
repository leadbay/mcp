import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, getHttpRequests, httpsMockFactory } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { setTelemetry } from "../../../src/composite/set-telemetry.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

const meWith = (telemetry_enabled: boolean | undefined) => ({
  method: "GET" as const,
  path: "/1.6/users/me",
  status: 200,
  body: {
    id: "u-1",
    email: "rep@acme.com",
    organization: { id: "org-1", name: "Acme" },
    ...(telemetry_enabled === undefined ? {} : { telemetry_enabled }),
  },
});

describe("leadbay_set_telemetry", () => {
  it("status — reports enabled, changes nothing, no write call", async () => {
    mockHttp([meWith(true)]);
    const result: any = await setTelemetry.execute(newClient(), { action: "status" });
    expect(result.telemetry_enabled).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.action).toBe("status");
    // Only the /users/me read — no POST /users/telemetry.
    const writes = getHttpRequests().filter((r) => r.method === "POST");
    expect(writes).toHaveLength(0);
  });

  it("status — absent telemetry_enabled (older backend) reads as ON", async () => {
    mockHttp([meWith(undefined)]);
    const result: any = await setTelemetry.execute(newClient(), { action: "status" });
    expect(result.telemetry_enabled).toBe(true);
  });

  it("default action is status (bare call is a safe read)", async () => {
    mockHttp([meWith(false)]);
    const result: any = await setTelemetry.execute(newClient(), {});
    expect(result.action).toBe("status");
    expect(result.telemetry_enabled).toBe(false);
    expect(result.changed).toBe(false);
  });

  it("disable — currently ON → POSTs telemetry_enabled:false, changed:true", async () => {
    mockHttp([
      meWith(true),
      { method: "POST", path: "/1.6/users/telemetry", status: 204, body: {} },
    ]);
    const result: any = await setTelemetry.execute(newClient(), { action: "disable" });
    expect(result.telemetry_enabled).toBe(false);
    expect(result.changed).toBe(true);
    const post = getHttpRequests().find((r) => r.method === "POST" && r.path === "/1.6/users/telemetry");
    expect(post).toBeTruthy();
    expect(JSON.parse(post!.body ?? "{}")).toEqual({ telemetry_enabled: false });
  });

  it("enable — currently OFF → POSTs telemetry_enabled:true, changed:true", async () => {
    mockHttp([
      meWith(false),
      { method: "POST", path: "/1.6/users/telemetry", status: 204, body: {} },
    ]);
    const result: any = await setTelemetry.execute(newClient(), { action: "enable" });
    expect(result.telemetry_enabled).toBe(true);
    expect(result.changed).toBe(true);
    const post = getHttpRequests().find((r) => r.method === "POST" && r.path === "/1.6/users/telemetry");
    expect(JSON.parse(post!.body ?? "{}")).toEqual({ telemetry_enabled: true });
  });

  it("disable — already OFF → idempotent no-op, changed:false, no write", async () => {
    mockHttp([meWith(false)]);
    const result: any = await setTelemetry.execute(newClient(), { action: "disable" });
    expect(result.telemetry_enabled).toBe(false);
    expect(result.changed).toBe(false);
    const writes = getHttpRequests().filter((r) => r.method === "POST");
    expect(writes).toHaveLength(0);
  });

  it("enable — already ON → idempotent no-op, changed:false, no write", async () => {
    mockHttp([meWith(true)]);
    const result: any = await setTelemetry.execute(newClient(), { action: "enable" });
    expect(result.telemetry_enabled).toBe(true);
    expect(result.changed).toBe(false);
    expect(getHttpRequests().filter((r) => r.method === "POST")).toHaveLength(0);
  });
});
