/**
 * product#3865 — the live quota API emits the lens-refill resource type as
 * lowercase `lens_extra_refill`, while older shapes/fixtures use uppercase
 * `LENS_EXTRA_REFILL`. readExtraRefillQuota() in extend-lens.ts matches
 * case-insensitively so the quota_exceeded error path surfaces used_today /
 * resets_at regardless of casing (an exact-case === would null them out on the
 * real API). New file — the existing extend-lens.test.ts is not modified.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../../harness.js";

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

const quotaBody = (resourceType: string) => ({
  plan: "TIER1",
  org: {
    spend: [],
    resources: [
      {
        resource_type: resourceType,
        count: 150,
        window_type: "daily",
        resets_at: "2026-05-29T00:00:00Z",
      },
    ],
  },
});

beforeEach(() => resetHttpMock());

describe("leadbay_extend_lens — lens-refill quota lookup is case-insensitive", () => {
  it("lowercase lens_extra_refill (live wire) → used_today/resets_at surfaced on 429", async () => {
    mockHttp([
      { method: "POST", path: "/1.6/lenses/9001/extra_refill", status: 429, body: { error: "quota_exceeded" } },
      { method: "GET", path: "/1.6/users/me", status: 200, body: ME_PAYLOAD },
      { method: "GET", path: "/1.6/organizations/org-1/quota_status", status: 200, body: quotaBody("lens_extra_refill") },
    ]);

    const out: any = await extendLens.execute(newClient(), { lensId: 9001, extra_count: 100 });

    expect(out.status).toBe("quota_exceeded");
    // The lowercase row was found — used_today/resets_at are NOT null.
    expect(out.quota?.used_today).toBe(150);
    expect(out.quota?.resets_at).toBe("2026-05-29T00:00:00Z");
  });

  it("mixed-case Lens_Extra_Refill is also matched", async () => {
    mockHttp([
      { method: "POST", path: "/1.6/lenses/9001/extra_refill", status: 429, body: { error: "quota_exceeded" } },
      { method: "GET", path: "/1.6/users/me", status: 200, body: ME_PAYLOAD },
      { method: "GET", path: "/1.6/organizations/org-1/quota_status", status: 200, body: quotaBody("Lens_Extra_Refill") },
    ]);

    const out: any = await extendLens.execute(newClient(), { lensId: 9001, extra_count: 100 });
    expect(out.status).toBe("quota_exceeded");
    expect(out.quota?.used_today).toBe(150);
  });
});
