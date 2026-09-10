import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory, getHttpRequests } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { collectJobSnapshot, assertSafeJobId } from "../../../src/composite/_mcp-job-helpers.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

describe("job_id path-traversal guard", () => {
  // The regression this exists for: encodeURIComponent does NOT escape `.`, so
  // `..` reached the URL verbatim and `new URL()` normalized
  // /1.6/mcp/jobs/..?limit=100 down to /1.6/mcp/?limit=100 — sending the bearer
  // token to an endpoint the caller never asked for.
  it.each([[".."], ["."], ["..."]])("rejects the dot segment %j", async (jobId) => {
    mockHttp([]);
    await expect(
      collectJobSnapshot(newClient(), jobId)
    ).rejects.toMatchObject({ code: "INVALID_JOB_ID" });
    // Nothing may reach the wire: the whole point is that the token never goes
    // to the re-pointed path.
    expect(getHttpRequests()).toHaveLength(0);
  });

  it.each([["a/b"], ["../users/me"], ["x?y=1"], ["x#f"], ["x y"], [""]])(
    "rejects the malformed handle %j without calling the API",
    async (jobId) => {
      mockHttp([]);
      await expect(
        collectJobSnapshot(newClient(), jobId)
      ).rejects.toMatchObject({ code: "INVALID_JOB_ID" });
      expect(getHttpRequests()).toHaveLength(0);
    }
  );

  it("rejects a non-string handle", async () => {
    mockHttp([]);
    await expect(
      collectJobSnapshot(newClient(), undefined as unknown as string)
    ).rejects.toMatchObject({ code: "INVALID_JOB_ID" });
  });

  it("rejects an absurdly long handle", () => {
    expect(() => assertSafeJobId("a".repeat(201))).toThrow();
    expect(() => assertSafeJobId("a".repeat(200))).not.toThrow();
  });

  it("still accepts the handles the backend actually issues", async () => {
    const ids = [
      "0a2fcbf5-18e1-4967-b5de-0c67cd823bcc",
      "search-auto-gyms-dallas-2026-07-28",
      "qualify-auto-abc_123",
      "j1",
    ];
    for (const id of ids) {
      resetHttpMock();
      mockHttp([
        {
          method: "GET",
          path: `/1.6/mcp/jobs/${id}?limit=100`,
          status: 200,
          body: {
            job: { state: "running" },
            items: [],
            funnel: {},
            cost: { spent: 0 },
            next_since: null,
          },
        },
      ]);
      await collectJobSnapshot(newClient(), id);
      // Asserting the PATH, not just that it succeeded: a handle that survives
      // validation must also land on /mcp/jobs/<id> unchanged.
      expect(getHttpRequests()[0].path).toBe(`/1.6/mcp/jobs/${id}?limit=100`);
    }
  });
});
