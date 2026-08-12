import { describe, it, expect, beforeEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../src/client.js";

const BASE = "https://api-us.leadbay.app";

beforeEach(() => resetHttpMock());

const meBody = (telemetry_enabled: boolean | undefined) => ({
  id: "u-1",
  email: "rep@acme.com",
  organization: { id: "org-1", name: "Acme" },
  ...(telemetry_enabled === undefined ? {} : { telemetry_enabled }),
});

describe("LeadbayClient telemetry refresh in mock mode", () => {
  it("fetchTelemetryEnabled honors LEADBAY_MOCK without auth or network", async () => {
    const dir = mkdtempSync(join(tmpdir(), "leadbay-mock-"));
    const prevMock = process.env.LEADBAY_MOCK;
    const prevDir = process.env.LEADBAY_MOCK_DIR;
    try {
      writeFileSync(
        join(dir, "users-me.json"),
        JSON.stringify({
          request: {
            method: "GET",
            url: "https://api-us.leadbay.app/1.6/users/me",
          },
          response: {
            status: 200,
            body: meBody(false),
          },
        })
      );
      process.env.LEADBAY_MOCK = "1";
      process.env.LEADBAY_MOCK_DIR = dir;
      mockHttp([]); // any network call would fail the test
      const client = new LeadbayClient(BASE, undefined, "us");
      const toolMeta = {
        region: "us" as const,
        endpoint: "GET /leads",
        latency_ms: 7,
        retry_after: null,
      };
      (client as any)._lastMeta = toolMeta;

      const observed = await client.fetchTelemetryEnabled();

      expect(observed).toBe(false);
      expect(client.cachedTelemetryEnabled()).toBe(false);
      expect(client.lastMeta).toBe(toolMeta);
    } finally {
      if (prevMock === undefined) delete process.env.LEADBAY_MOCK;
      else process.env.LEADBAY_MOCK = prevMock;
      if (prevDir === undefined) delete process.env.LEADBAY_MOCK_DIR;
      else process.env.LEADBAY_MOCK_DIR = prevDir;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
