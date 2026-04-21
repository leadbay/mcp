/**
 * LIVE smoke tests against the real Leadbay API.
 * Opt-in: set LEADBAY_TEST_TOKEN (and optionally LEADBAY_TEST_BASE_URL).
 *
 * Governance:
 *   - Use a DEDICATED test tenant
 *   - Use a LEAST-PRIVILEGED, READ-ONLY token
 *   - Smoke hits only read endpoints (/lenses, /users/me, taste profile)
 *   - No live login / enrich / qualify / add-note
 */

import { describe, it, expect } from "vitest";
import { LeadbayClient } from "../../src/client.js";

const TOKEN = process.env.LEADBAY_TEST_TOKEN;
const BASE_URL = process.env.LEADBAY_TEST_BASE_URL ?? "https://api-us.leadbay.app";

const runLive = !!TOKEN;
if (!runLive) {
  // eslint-disable-next-line no-console
  console.log(
    "[smoke] SMOKE_SKIPPED: set LEADBAY_TEST_TOKEN to run live smoke tests"
  );
}

describe.skipIf(!runLive)("LeadClaw live smoke (read-only endpoints)", () => {
  const client = new LeadbayClient(BASE_URL, TOKEN);

  it("/users/me returns an organization with numeric ai_credits", async () => {
    const me = await client.request<any>("GET", "/users/me");
    expect(me.organization).toBeTypeOf("object");
    expect(me.organization.id).toBeTypeOf("string");
    expect(typeof me.organization.billing?.ai_credits).toBe("number");
  });

  it("/lenses returns a non-empty array with expected shape", async () => {
    const lenses = await client.request<any[]>("GET", "/lenses");
    expect(Array.isArray(lenses)).toBe(true);
    expect(lenses.length).toBeGreaterThan(0);
    const l = lenses[0];
    expect(l.id).toBeTypeOf("number");
    expect(l.name).toBeTypeOf("string");
    expect(typeof l.is_last_active === "boolean").toBe(true);
  });

  it("resolveDefaultLens returns a numeric lens id", async () => {
    const id = await client.resolveDefaultLens();
    expect(typeof id).toBe("number");
  });

  it("resolveTasteProfile returns the three-part shape (even if partial)", async () => {
    const tp = await client.resolveTasteProfile();
    expect(tp).toHaveProperty("idealBuyerProfile");
    expect(Array.isArray(tp.purchaseIntentTags)).toBe(true);
    expect(Array.isArray(tp.qualificationQuestions)).toBe(true);
  });
});
