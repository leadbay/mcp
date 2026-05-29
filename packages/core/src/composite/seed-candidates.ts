/**
 * leadbay_seed_candidates — GET /lenses/{id}/seed_candidates
 *
 * Returns a ranked list of leads currently in the lens that are valid
 * inputs to leadbay_extend_lens. Each candidate carries enough signal
 * (description, sector, tags, qq_answers, engagement) for the agent to
 * pick seeds without per-lead follow-up calls.
 *
 * Backend contract: api-specs backend/1.6/routes/lenses/seed_candidates.yml.
 * Response is relayed verbatim — purpose is to give the agent rich signal.
 */
import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";

import { leadbay_seed_candidates as SEED_CANDIDATES_DESCRIPTION } from "../tool-descriptions.generated.js";

interface SeedCandidatesParams {
  lensId?: number;
  limit?: number;
}

interface QqAnswer {
  question_id?: string;
  question?: string;
  answer?: string;
  score?: number | null;
}

interface SeedEngagement {
  liked: boolean;
  org_contacts_count: number;
  prospecting_actions_count: number;
}

interface SeedCandidate {
  lead_id: string;
  name: string;
  description?: string | null;
  sector?: string | null;
  size_min?: number | null;
  size_max?: number | null;
  website?: string | null;
  ai_agent_score?: number | null;
  tags?: string[];
  qq_answers?: QqAnswer[];
  org_lead_status?: string | null;
  engagement: SeedEngagement;
}

interface SeedCandidatesResponse {
  candidates: SeedCandidate[];
}

export const seedCandidates: Tool<SeedCandidatesParams> = {
  name: "leadbay_seed_candidates",
  annotations: {
    title: "List candidate seeds for a lens extra-refill",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: SEED_CANDIDATES_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      lensId: {
        type: "number",
        description:
          "Lens to fetch candidates for. Defaults to the user's last-active lens.",
      },
      limit: {
        type: "number",
        description:
          "Max candidates to return, 1–50 (backend default 20).",
      },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      lens: {
        type: "object",
        properties: { id: { type: "number" } },
      },
      candidates: {
        type: "array",
        description:
          "Ranked candidate leads — each is a valid seed for leadbay_extend_lens. Pick 3–5 that represent the kind of leads the user wants more of.",
        items: { type: "object" },
      },
    },
    required: ["lens", "candidates"],
  },
  execute: async (client: LeadbayClient, params: SeedCandidatesParams) => {
    const lensId = params.lensId ?? (await client.resolveDefaultLens());
    const limit = params.limit != null ? Math.max(1, Math.min(params.limit, 50)) : 20;

    const res = await client.request<SeedCandidatesResponse>(
      "GET",
      `/lenses/${lensId}/seed_candidates?limit=${limit}`,
    );

    return {
      lens: { id: lensId },
      candidates: res.candidates,
    };
  },
};
