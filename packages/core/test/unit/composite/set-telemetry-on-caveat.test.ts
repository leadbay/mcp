import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../../harness.js";
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

// The OFF hints already carry the LEADBAY_TELEMETRY_ENABLED caveat (covered by
// the existing suite). These assert the MIRROR fix (Codex P2): ON / status /
// no-op-enable responses must ALSO qualify that this is the ACCOUNT setting and
// a local install follows the startup env var — so we never tell a local user
// "ON" when their process was launched with LEADBAY_TELEMETRY_ENABLED=false.
const LOCAL_ENV = "LEADBAY_TELEMETRY_ENABLED";

describe("leadbay_set_telemetry — ON responses carry the local-env caveat [Codex P2]", () => {
  it("status when ON — hint qualifies it as the account setting + names the env var", async () => {
    mockHttp([meWith(true)]);
    const result: any = await setTelemetry.execute(newClient(), { action: "status" });
    expect(result.telemetry_enabled).toBe(true);
    expect(result.hint).toContain(LOCAL_ENV);
    expect(result.hint.toLowerCase()).toContain("account");
  });

  it("enable — already ON → no-op hint also carries the caveat", async () => {
    mockHttp([meWith(true)]);
    const result: any = await setTelemetry.execute(newClient(), { action: "enable" });
    expect(result.changed).toBe(false);
    expect(result.hint).toContain(LOCAL_ENV);
  });

  it("enable — was OFF → now-ON hint carries the caveat", async () => {
    mockHttp([
      meWith(false),
      { method: "POST", path: "/1.6/users/telemetry", status: 204, body: {} },
      meWith(true),
    ]);
    const result: any = await setTelemetry.execute(newClient(), { action: "enable" });
    expect(result.telemetry_enabled).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.hint).toContain(LOCAL_ENV);
  });
});

describe("leadbay_set_telemetry — post-write refresh is fire-and-forget [Codex P2]", () => {
  it("disable — returns without awaiting the reconcile /me refresh (does not hang on a pending backend)", async () => {
    // Only two scripts: the pre-read and the POST. NO third /users/me script.
    // If the tool AWAITED the post-write refresh, the harness would either block
    // or throw "no script matched" for that GET. Because it's fire-and-forget
    // (void-ed), execute() resolves from the stamped cache and returns cleanly.
    mockHttp([
      meWith(true),
      { method: "POST", path: "/1.6/users/telemetry", status: 204, body: {} },
    ]);
    const client = newClient();
    const result: any = await setTelemetry.execute(client, { action: "disable" });
    expect(result.error).toBeUndefined();
    expect(result.telemetry_enabled).toBe(false);
    expect(result.changed).toBe(true);
    // Cache was stamped synchronously before the fire-and-forget refresh.
    expect(client.cachedTelemetryEnabled()).toBe(false);
  });
});
