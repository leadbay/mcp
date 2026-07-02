/**
 * LIVE smoke tests against the real Leadbay API.
 * Opt-in: set LEADBAY_TEST_TOKEN (and optionally LEADBAY_TEST_BASE_URL).
 *
 * v0.2.0 extensions: cover the new endpoints the autoplan composites depend on
 * (lens filter, user_prompt with 204 handling, clarifications with 204
 * handling, ai_agent_responses, quota_status, sectors taxonomy).
 *
 * Governance:
 *   - Use a DEDICATED test tenant
 *   - Use a LEAST-PRIVILEGED, READ-ONLY token
 *   - Smoke hits only read endpoints
 *   - No live login / enrich / qualify / add-note / set_user_prompt
 */

import { describe, it, expect } from "vitest";
import { LeadbayClient } from "../../src/client.js";
import type {
  ClarificationPayload,
  FilterPayload,
  QuotaStatusPayload,
  SectorPayload,
  UserPromptPayload,
  AiAgentResponse,
  WishlistResponse,
} from "../../src/types.js";

const TOKEN = process.env.LEADBAY_TEST_TOKEN;
const BASE_URL = process.env.LEADBAY_TEST_BASE_URL ?? "https://api-us.leadbay.app";

const runLive = !!TOKEN;
if (!runLive) {
  // eslint-disable-next-line no-console
  console.log(
    "[smoke] SMOKE_SKIPPED: set LEADBAY_TEST_TOKEN to run live smoke tests"
  );
}

describe.skipIf(!runLive)("leadbay-mcp live smoke (read-only endpoints)", () => {
  const client = new LeadbayClient(BASE_URL, TOKEN);

  it("/users/me returns nested organization (post-v0.2 shape)", async () => {
    const me = await client.request<any>("GET", "/users/me");
    expect(me.organization).toBeTypeOf("object");
    expect(me.organization.id).toBeTypeOf("string");
    // last_requested_lens may be null on a fresh tenant.
    expect(typeof me.last_requested_lens === "number" || me.last_requested_lens === null).toBe(true);
  });

  it("/lenses returns a non-empty array with expected shape", async () => {
    const lenses = await client.request<any[]>("GET", "/lenses");
    expect(Array.isArray(lenses)).toBe(true);
    expect(lenses.length).toBeGreaterThan(0);
    const l = lenses[0];
    // 2026-04-21: the backend sometimes returns lens.id as a string (e.g. "21520")
    // and sometimes as a number (e.g. 21448). LensPayload allows both. See SHAPE-DRIFT.md.
    expect(typeof l.id === "number" || typeof l.id === "string").toBe(true);
    expect(l.name).toBeTypeOf("string");
  });

  it("resolveDefaultLens returns a numeric lens id (prefers /me.last_requested_lens)", async () => {
    const id = await client.resolveDefaultLens();
    expect(typeof id).toBe("number");
  });

  it("resolveTasteProfile returns the three-part shape (even if partial)", async () => {
    const tp = await client.resolveTasteProfile();
    expect(tp).toHaveProperty("idealBuyerProfile");
    expect(Array.isArray(tp.purchaseIntentTags)).toBe(true);
    expect(Array.isArray(tp.qualificationQuestions)).toBe(true);
  });

  it("/lenses/{id}/filter returns the criteria-based shape", async () => {
    const lensId = await client.resolveDefaultLens();
    const filter = await client.request<FilterPayload>(
      "GET",
      `/lenses/${lensId}/filter`
    );
    expect(filter).toHaveProperty("lens_filter");
    expect(filter).toHaveProperty("locations");
  });

  it("/sectors/all?lang=en returns a populated taxonomy", async () => {
    const sectors = await client.request<SectorPayload[]>(
      "GET",
      "/sectors/all?lang=en&includeInvisible=false"
    );
    expect(Array.isArray(sectors)).toBe(true);
    expect(sectors.length).toBeGreaterThan(100);
  });

  it("/organizations/{id}/quota_status returns spend + resource windows", async () => {
    const orgId = await client.resolveOrgId();
    const q = await client.request<QuotaStatusPayload>(
      "GET",
      `/organizations/${orgId}/quota_status`
    );
    expect(q).toHaveProperty("plan");
    expect(q.org).toHaveProperty("spend");
    expect(Array.isArray(q.org.spend)).toBe(true);
  });

  it("/organizations/{id}/user_prompt handles 204 cleanly", async () => {
    const orgId = await client.resolveOrgId();
    const p = await client.request<UserPromptPayload | null>(
      "GET",
      `/organizations/${orgId}/user_prompt`
    );
    // Either null (204) or a {prompt} object — no shape errors.
    expect(p === null || (p && typeof p.prompt === "string")).toBe(true);
  });

  it("/organizations/{id}/clarifications handles 204 cleanly", async () => {
    const orgId = await client.resolveOrgId();
    const c = await client.request<ClarificationPayload | null>(
      "GET",
      `/organizations/${orgId}/clarifications`
    );
    expect(c === null || (c && typeof c.question === "string")).toBe(true);
  });

  it("wishlist + ai_agent_responses for the first lead populate", async () => {
    const lensId = await client.resolveDefaultLens();
    const wish = await client.request<WishlistResponse>(
      "GET",
      `/lenses/${lensId}/leads/wishlist?count=1&page=0`
    );
    expect(wish.pagination).toHaveProperty("page");
    if (wish.items[0]) {
      const r = await client.request<AiAgentResponse[]>(
        "GET",
        `/leads/${wish.items[0].id}/ai_agent_responses`
      );
      expect(Array.isArray(r)).toBe(true);
      // May be empty if the lead hasn't been qualified yet — that's fine.
    }
  });
});
