// product#3761 — account_status must NOT surface a quota_status 401/403 to the
// agent. For a plan-less org (plan: null) the backend 401s quota_status while
// /users/me succeeds with the same token; prompt guidance alone was leaky (the
// agent still hedged "quota had a hiccup"), so the composite withholds the
// quota_error from the payload entirely for auth-status codes. A genuine
// non-auth failure (500) still surfaces as quota_error so the agent can say
// quota is unreadable for a real reason. Also locks lens id → name resolution
// with string-id normalization.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { accountStatus } from "../../../src/composite/account-status.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");
const ORG = "org-1";

const me = (last_requested_lens: unknown) => ({
  email: "a@b.co",
  name: "A",
  admin: true,
  manager: false,
  language: "en",
  organization: { id: ORG, name: "PlanlessCo", ai_agent_enabled: true, computing_intelligence: false },
  last_requested_lens,
});

beforeEach(() => resetHttpMock());

describe("account_status — quota 401 withheld (product#3761)", () => {
  it("a 401 on quota_status is NOT surfaced: quota_error stays null", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: me("40005") },
      { method: "GET", path: "/1.5/users/me", status: 200, body: me("40005") }, // retry tolerance
      { method: "GET", path: `/1.5/organizations/${ORG}/quota_status`, status: 401, body: {} },
      { method: "GET", path: `/1.5/organizations/${ORG}/quota_status`, status: 401, body: {} },
      { method: "GET", path: "/1.5/lenses", status: 200, body: [{ id: "40005", name: "Autom Lens" }] },
    ]);
    const r: any = await accountStatus.execute(newClient(), {});
    expect(r.quota).toBeNull();
    expect(r.quota_error).toBeNull(); // withheld — the agent must not see it
  });

  it("a 403 on quota_status is also withheld", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: me("40005") },
      { method: "GET", path: "/1.5/users/me", status: 200, body: me("40005") },
      { method: "GET", path: `/1.5/organizations/${ORG}/quota_status`, status: 403, body: {} },
      { method: "GET", path: `/1.5/organizations/${ORG}/quota_status`, status: 403, body: {} },
      { method: "GET", path: "/1.5/lenses", status: 200, body: [{ id: "40005", name: "Autom Lens" }] },
    ]);
    const r: any = await accountStatus.execute(newClient(), {});
    expect(r.quota_error).toBeNull();
  });

  it("a genuine non-auth failure (500) DOES surface as quota_error", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: me("40005") },
      { method: "GET", path: `/1.5/organizations/${ORG}/quota_status`, status: 500, body: { code: "SERVER_ERROR", message: "boom" } },
      { method: "GET", path: "/1.5/lenses", status: 200, body: [{ id: "40005", name: "Autom Lens" }] },
    ]);
    const r: any = await accountStatus.execute(newClient(), {});
    expect(r.quota_error).not.toBeNull();
    expect(r.quota_error.http_status).toBe(500);
  });
});

describe("account_status — lens id → name (product#3761)", () => {
  it("resolves last_requested_lens to its name with string-id normalization", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: me(40005) }, // number from /me
      { method: "GET", path: `/1.5/organizations/${ORG}/quota_status`, status: 200, body: { org: { resources: {} } } },
      { method: "GET", path: "/1.5/lenses", status: 200, body: [{ id: "40005", name: "Autom Lens" }] }, // string id server-side
    ]);
    const r: any = await accountStatus.execute(newClient(), {});
    // returned id is normalized to a string, matching the schema
    expect(r.last_requested_lens).toBe("40005");
    // name resolves despite the number-vs-string mismatch
    expect(r.last_requested_lens_name).toBe("Autom Lens");
  });

  it("null lens id → null name, no /lenses call", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: me(null) },
      { method: "GET", path: `/1.5/organizations/${ORG}/quota_status`, status: 200, body: { org: { resources: {} } } },
    ]);
    const r: any = await accountStatus.execute(newClient(), {});
    expect(r.last_requested_lens).toBeNull();
    expect(r.last_requested_lens_name).toBeNull();
  });
});
