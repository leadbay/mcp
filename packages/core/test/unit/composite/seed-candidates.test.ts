/**
 * Unit tests for leadbay_seed_candidates.
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
import { seedCandidates } from "../../../src/composite/seed-candidates.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.tok", "us");

const ME_PAYLOAD = {
  id: "u-1",
  email: "u@example.com",
  organization: { id: "org-1", name: "Acme" },
  last_requested_lens: 4242,
};

const SAMPLE_CANDIDATE = {
  lead_id: "11111111-1111-1111-1111-111111111111",
  name: "Acme Industries",
  description: "Industrial supplies for manufacturing.",
  sector: "Manufacturing",
  size_min: 50,
  size_max: 200,
  website: "https://acme.example",
  ai_agent_score: 78,
  tags: ["expansion-stage", "us-east"],
  qq_answers: [
    { question: "ICP fit", answer: "Strong — matches mid-market profile.", score: 20 },
  ],
  org_lead_status: null,
  engagement: {
    liked: true,
    org_contacts_count: 2,
    prospecting_actions_count: 3,
  },
};

beforeEach(() => {
  resetHttpMock();
});

describe("leadbay_seed_candidates", () => {
  it("happy path — explicit lensId + limit returns candidates shape", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.5/lenses/9001/seed_candidates?limit=10",
        status: 200,
        body: { candidates: [SAMPLE_CANDIDATE] },
      },
    ]);

    const out = await seedCandidates.execute(newClient(), {
      lensId: 9001,
      limit: 10,
    });

    expect(out.lens.id).toBe(9001);
    expect(out.candidates).toHaveLength(1);
    expect(out.candidates[0].lead_id).toBe(SAMPLE_CANDIDATE.lead_id);
    expect(out.candidates[0].engagement.liked).toBe(true);
  });

  it("lensId omitted — falls back to last_requested_lens via /users/me", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 200,
        body: ME_PAYLOAD,
      },
      {
        method: "GET",
        path: "/1.5/lenses/4242/seed_candidates?limit=20",
        status: 200,
        body: { candidates: [SAMPLE_CANDIDATE] },
      },
    ]);

    const out = await seedCandidates.execute(newClient(), {});

    expect(out.lens.id).toBe(4242);
    expect(out.candidates).toHaveLength(1);

    const reqs = getHttpRequests();
    expect(reqs.some((r) => r.path === "/1.5/users/me")).toBe(true);
    expect(
      reqs.some((r) =>
        r.path === "/1.5/lenses/4242/seed_candidates?limit=20",
      ),
    ).toBe(true);
  });

  it("empty candidates — returns empty array", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.5/lenses/9001/seed_candidates?limit=20",
        status: 200,
        body: { candidates: [] },
      },
    ]);

    const out = await seedCandidates.execute(newClient(), { lensId: 9001 });

    expect(out.candidates).toEqual([]);
  });

  it("limit clamped to 1..50", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.5/lenses/9001/seed_candidates?limit=50",
        status: 200,
        body: { candidates: [] },
      },
    ]);

    // Caller sends 999 → tool clamps to 50.
    await seedCandidates.execute(newClient(), { lensId: 9001, limit: 999 });

    const reqs = getHttpRequests();
    expect(reqs[0].path).toBe("/1.5/lenses/9001/seed_candidates?limit=50");
  });
});
