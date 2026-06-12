import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../src/client.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

// When a 401 survives the automatic retry, the ONLY thing we know for certain is
// that the token didn't time out (Leadbay tokens don't expire on a timer). A
// persistent 401 is either a Leadbay-side hiccup OR a genuine logout/revocation
// (per Milan's review on PR #96), so the copy must name both causes and assert
// neither — it must NOT over-claim that the login is fine, and must NOT push
// re-login as the default. Stays short; offers to report it to the team.
describe("LeadbayClient — persistent 401 names both causes, over-claims neither", () => {
  it("acknowledges the logout possibility without claiming the login is fine", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/lenses", status: 401, body: {} },
      { method: "GET", path: "/1.5/lenses", status: 401, body: {} },
    ]);
    try {
      await newClient().request("GET", "/lenses");
      expect.fail("should have thrown");
    } catch (err: any) {
      const hint = err.hint.toLowerCase();
      expect(hint).toContain("leadbay-side");
      expect(hint).toContain("try again");
      // Names the logout cause too — pins Milan's correction so it can't regress.
      expect(hint).toContain("logged out");
      // Offers to report the persistent failure to the team (handoff to feedback).
      expect(hint).toContain("report it");
      // Stays concise (no multi-paragraph lecture, no login instructions).
      expect(err.hint.length).toBeLessThan(220);
      // Does NOT over-claim the login is fine, and does NOT push re-login.
      expect(hint).not.toContain("your token is fine");
      expect(hint).not.toContain("mcp login");
      expect(hint).not.toContain("re-authenticate");
    }
  });
});
