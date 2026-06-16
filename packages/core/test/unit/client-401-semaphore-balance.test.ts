import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../src/client.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

// The GET-401 retry releases the concurrency slot before its 250ms backoff and
// re-acquires it after (release → sleep → re-acquire). That balance is an
// invariant-by-construction in httpsRequestWithRetry; these tests guard the
// release→re-acquire window so a future early-return/throw can't silently leak
// or double-release a slot. Asserted via the _semaphoreState getter.
describe("LeadbayClient — semaphore stays balanced across a 401 retry", () => {
  it("returns to zero active after a retried-then-succeeded GET 401", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/lenses", status: 401, body: {} },
      { method: "GET", path: "/1.5/lenses", status: 200, body: { ok: true } },
    ]);
    const client = newClient();
    expect(client._semaphoreState.active).toBe(0);
    await client.request("GET", "/lenses");
    // The slot released during the backoff is fully reclaimed and released again.
    expect(client._semaphoreState.active).toBe(0);
    expect(client._semaphoreState.queued).toBe(0);
  });

  it("returns to zero active after a persistent GET 401 (retry also 401s, throws)", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/lenses", status: 401, body: {} },
      { method: "GET", path: "/1.5/lenses", status: 401, body: {} },
    ]);
    const client = newClient();
    await expect(client.request("GET", "/lenses")).rejects.toMatchObject({
      code: "AUTH_EXPIRED",
    });
    // Even on the throwing path, the slot is released — no leak.
    expect(client._semaphoreState.active).toBe(0);
    expect(client._semaphoreState.queued).toBe(0);
  });

  it("returns to zero active after a non-retried POST 401", async () => {
    mockHttp([{ method: "POST", path: "/1.5/leads/epilogue", status: 401, body: {} }]);
    const client = newClient();
    await expect(
      client.requestVoid("POST", "/leads/epilogue", { foo: "bar" })
    ).rejects.toMatchObject({ code: "AUTH_EXPIRED" });
    expect(client._semaphoreState.active).toBe(0);
    expect(client._semaphoreState.queued).toBe(0);
  });
});
