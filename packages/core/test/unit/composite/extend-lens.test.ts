/**
 * Unit tests for leadbay_extend_lens.
 *
 * Covers the queued happy path (with and without seeds) plus the three
 * documented error envelopes the composite translates so the agent can
 * route on `status`: quota_exceeded, refresh_in_progress, no_valid_seeds.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
  getHttpRequests,
} from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { extendLens } from "../../../src/composite/extend-lens.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.tok", "us");

const ME_PAYLOAD = {
  id: "u-1",
  email: "u@example.com",
  organization: { id: "org-1", name: "Acme" },
  last_requested_lens: 4242,
};

beforeEach(() => {
  resetHttpMock();
});

describe("leadbay_extend_lens", () => {
  it("happy path with seeds — returns queued envelope", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.5/lenses/9001/extra_refill",
        status: 200,
        body: {
          accepted_seeds: [
            "11111111-1111-1111-1111-111111111111",
            "22222222-2222-2222-2222-222222222222",
          ],
        },
      },
    ]);

    const out = await extendLens.execute(newClient(), {
      lensId: 9001,
      seed_lead_ids: [
        "11111111-1111-1111-1111-111111111111",
        "22222222-2222-2222-2222-222222222222",
      ],
      extra_count: 20,
    });

    expect(out.status).toBe("queued");
    expect(out.lens.id).toBe(9001);
    expect(out.accepted_seeds).toHaveLength(2);
    expect(out.message).toMatch(/queued/i);

    const reqs = getHttpRequests();
    expect(reqs).toHaveLength(1);
    const body = JSON.parse(reqs[0].body ?? "{}");
    expect(body.seed_lead_ids).toHaveLength(2);
    expect(body.extra_count).toBe(20);
  });

  it("happy path without seeds — sends empty seed_lead_ids array, no extra_count", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 200,
        body: ME_PAYLOAD,
      },
      {
        method: "POST",
        path: "/1.5/lenses/4242/extra_refill",
        status: 200,
        body: { accepted_seeds: [] },
      },
    ]);

    const out = await extendLens.execute(newClient(), {});

    expect(out.status).toBe("queued");
    expect(out.lens.id).toBe(4242);
    expect(out.accepted_seeds).toEqual([]);

    const reqs = getHttpRequests();
    const postReq = reqs.find((r) => r.method === "POST");
    const body = JSON.parse(postReq?.body ?? "{}");
    expect(body.seed_lead_ids).toEqual([]);
    expect(body.extra_count).toBeUndefined();
  });

  it("429 quota_exceeded — translates to envelope with quota lookup", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.5/lenses/9001/extra_refill",
        status: 429,
        body: { error: "quota_exceeded" },
      },
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 200,
        body: ME_PAYLOAD,
      },
      {
        method: "GET",
        path: "/1.5/organizations/org-1/quota_status",
        status: 200,
        body: {
          plan: "TIER1",
          org: {
            spend: [],
            resources: [
              {
                resource_type: "LENS_EXTRA_REFILL",
                count: 150,
                window_type: "daily",
                resets_at: "2026-05-29T00:00:00Z",
              },
            ],
          },
        },
      },
    ]);

    const out = await extendLens.execute(newClient(), {
      lensId: 9001,
      extra_count: 100,
    });

    expect(out.status).toBe("quota_exceeded");
    expect(out.lens.id).toBe(9001);
    expect(out.quota?.used_today).toBe(150);
    expect(out.quota?.resets_at).toBe("2026-05-29T00:00:00Z");
    expect(out.message).toMatch(/quota/i);
    expect(out.message).toMatch(/2026-05-29/);
    expect(out.message).toMatch(/upgrade/i);
  });

  it("429 quota_exceeded — gracefully handles quota lookup failure", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.5/lenses/9001/extra_refill",
        status: 429,
        body: { error: "quota_exceeded" },
      },
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 500,
        body: "boom",
      },
    ]);

    const out = await extendLens.execute(newClient(), {
      lensId: 9001,
      extra_count: 100,
    });

    expect(out.status).toBe("quota_exceeded");
    expect(out.quota?.used_today).toBeNull();
    expect(out.quota?.resets_at).toBeNull();
    expect(out.message).toMatch(/quota/i);
  });

  it("409 refresh_in_progress — translates to envelope", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.5/lenses/9001/extra_refill",
        status: 409,
        body: { error: "refresh_in_progress" },
      },
    ]);

    const out = await extendLens.execute(newClient(), { lensId: 9001 });

    expect(out.status).toBe("refresh_in_progress");
    expect(out.lens.id).toBe(9001);
    expect(out.message).toMatch(/already (running|filling)/i);
  });

  it("400 no_valid_seeds — translates to envelope", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.5/lenses/9001/extra_refill",
        status: 400,
        body: { error: "no_valid_seeds" },
      },
    ]);

    const out = await extendLens.execute(newClient(), {
      lensId: 9001,
      seed_lead_ids: ["00000000-0000-0000-0000-000000000000"],
    });

    expect(out.status).toBe("no_valid_seeds");
    expect(out.lens.id).toBe(9001);
    expect(out.message).toMatch(/stale|refetch|leadbay_seed_candidates/i);
  });

  it("unexpected error (500) — propagates as LeadbayError", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.5/lenses/9001/extra_refill",
        status: 500,
        body: { message: "internal" },
      },
    ]);

    await expect(
      extendLens.execute(newClient(), { lensId: 9001 }),
    ).rejects.toMatchObject({ code: "API_ERROR" });
  });
});
