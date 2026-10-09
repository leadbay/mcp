/**
 * buildServer({ includeApps }) tells the client, so a tool can offer a board
 * the way the host opens it (tour_plan's Route planner step:
 * core/test/unit/composite/tour-plan-board-on-apps-hosts.test.ts).
 *
 * New file — does not modify server.test.ts.
 */

import { describe, it, expect, vi } from "vitest";
import { httpsMockFactory } from "../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "@leadbay/core";
import { buildServer } from "../../src/server.js";

const BASE = "https://api-us.leadbay.app";

describe("client.apps follows includeApps", () => {
  it("is false on the Claude surface (default and explicit)", () => {
    const a = new LeadbayClient(BASE, "u.test-token");
    buildServer(a, {});
    expect(a.apps).toBe(false);
    const b = new LeadbayClient(BASE, "u.test-token");
    buildServer(b, { includeApps: false });
    expect(b.apps).toBe(false);
  });

  it("is true on the apps surfaces", () => {
    const c = new LeadbayClient(BASE, "u.test-token");
    buildServer(c, { includeApps: true });
    expect(c.apps).toBe(true);
  });
});
