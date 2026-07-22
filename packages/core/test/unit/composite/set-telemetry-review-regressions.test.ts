import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, getHttpRequests, httpsMockFactory } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { setTelemetry } from "../../../src/composite/set-telemetry.js";

const BASE = "https://api-us.leadbay.app";

beforeEach(() => resetHttpMock());

describe("leadbay_set_telemetry review regressions", () => {
  it("explicit enable no-op stamps confirmed ON so stale suppression can reopen immediately", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.6/users/me",
        status: 200,
        body: {
          id: "u-1",
          email: "rep@acme.com",
          organization: { id: "org-1", name: "Acme" },
          telemetry_enabled: true,
        },
      },
    ]);
    const client = new LeadbayClient(BASE, "u.test-token", "us");

    const result: any = await setTelemetry.execute(client, { action: "enable" });

    expect(result.changed).toBe(false);
    expect(result.telemetry_enabled).toBe(true);
    expect(client.cachedTelemetryEnabled()).toBe(true);
    expect(client.cachedTelemetryStamped()).toBe(true);
    expect(getHttpRequests().filter((r) => r.method === "POST")).toHaveLength(0);
  });
});
