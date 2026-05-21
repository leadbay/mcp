/**
 * Live smoke for the campaign trio + tour_plan composites (gated by
 * LEADBAY_TEST_TOKEN). Exercises the snake_case wire shape discovered
 * during the live probe (.context/campaigns-probe/API.md):
 *
 *   1. tourPlan({city}) — verifies the mixed-mode flow against the
 *      account's active lens (returns whatever it has; we just assert
 *      shape, not depth).
 *   2. createCampaign({name, lead_ids: []}) — empty seed.
 *   3. addLeadsToCampaign({campaign_id, lead_ids}) — with a real
 *      lead pulled from pull_leads.
 *   4. campaignProgression({campaign_id}) — verifies the per-lead
 *      progress + affiliation envelope.
 *   5. listCampaigns() — verifies the campaign is visible.
 *   6. DELETE /campaigns/{id} cleanup so the test account stays tidy.
 *
 * Test names use a timestamp prefix `MCP_WORKFLOWS_AUDIT_<ts>_*` so a
 * stray failure leaves identifiable garbage easy to bulk-delete.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@leadbay/core";
import { tourPlan } from "@leadbay/core/dist/composite/tour-plan.js";
import { createCampaign } from "@leadbay/core/dist/composite/create-campaign.js";
import { addLeadsToCampaign } from "@leadbay/core/dist/composite/add-leads-to-campaign.js";
import { listCampaigns } from "@leadbay/core/dist/composite/list-campaigns.js";
import { campaignProgression } from "@leadbay/core/dist/composite/campaign-progression.js";
import { pullLeads } from "@leadbay/core/dist/composite/pull-leads.js";

const TOKEN = process.env.LEADBAY_TEST_TOKEN ?? null;
const REGION = (process.env.LEADBAY_TEST_REGION ?? "us") as "us" | "fr";

const SKIP_REASON: string | null = TOKEN
  ? null
  : "no LEADBAY_TEST_TOKEN — set to run live-campaigns smoke";

if (SKIP_REASON) {
  console.log(`[live-campaigns] SMOKE_SKIPPED: ${SKIP_REASON}`);
}

const client = TOKEN
  ? createClient({ token: TOKEN, region: REGION })
  : null;

const TAG = `MCP_WORKFLOWS_AUDIT_${Date.now()}`;
let createdCampaignId: string | null = null;

describe.skipIf(!client)("live: tour_plan + campaign trio (snake_case wire)", () => {
  afterAll(async () => {
    // Clean up any campaign we created — directly via the client so we
    // don't need a delete tool in the public surface.
    if (createdCampaignId && client) {
      try {
        await client.requestVoid("DELETE", `/campaigns/${createdCampaignId}`);
      } catch (e) {
        console.warn(
          `[live-campaigns] cleanup: failed to delete ${createdCampaignId}: ${(e as Error).message}`,
        );
      }
    }
  });

  it("tour_plan returns a structured envelope", async () => {
    if (!client) return;
    const res = (await tourPlan.execute(client, { city: "New York" })) as any;
    // Shape assertions — depth depends on test-account data; just
    // assert envelope keys + types.
    expect(res).toBeTypeOf("object");
    expect(Array.isArray(res.monitor_leads)).toBe(true);
    expect(Array.isArray(res.discover_leads)).toBe(true);
    expect(res._meta).toBeTypeOf("object");
    expect(res._meta.region).toBe("us");
  });

  it("createCampaign with empty lead_ids succeeds (snake_case wire)", async () => {
    if (!client) return;
    const name = `${TAG}_create_empty`;
    const campaign = (await createCampaign.execute(client, {
      name,
      lead_ids: [],
    })) as any;
    expect(campaign.id).toBeTypeOf("string");
    expect(campaign.name).toBe(name);
    expect(campaign.created_at).toBeTypeOf("string");
    expect(campaign.archived).toBe(false);
    createdCampaignId = campaign.id;
  });

  it("listCampaigns includes the just-created campaign with zero-leads stats", async () => {
    if (!client || !createdCampaignId) return;
    const res = (await listCampaigns.execute(client, {})) as any;
    expect(Array.isArray(res.campaigns)).toBe(true);
    const ours = res.campaigns.find(
      (c: any) => c.campaign.id === createdCampaignId,
    );
    expect(ours).toBeDefined();
    expect(ours.lead_count).toBe(0);
    expect(ours.contact_count).toBe(0);
  });

  it("addLeadsToCampaign attaches a real lead from the active lens", async () => {
    if (!client || !createdCampaignId) return;
    // Pull a small page from the active lens to source a real lead UUID.
    const leadsRes = (await pullLeads.execute(client, { count: 1 })) as any;
    const sample = leadsRes?.leads?.[0];
    if (!sample?.id) {
      console.warn(
        "[live-campaigns] skip add-leads: account has no discoverable leads",
      );
      return;
    }
    const addRes = (await addLeadsToCampaign.execute(client, {
      campaign_id: createdCampaignId,
      lead_ids: [sample.id],
    })) as any;
    expect(addRes.added + addRes.already_present).toBe(1);
  });

  it("campaignProgression returns items + pagination + summary", async () => {
    if (!client || !createdCampaignId) return;
    const res = (await campaignProgression.execute(client, {
      campaign_id: createdCampaignId,
    })) as any;
    expect(Array.isArray(res.items)).toBe(true);
    expect(res.pagination).toBeTypeOf("object");
    expect(res.summary).toBeTypeOf("object");
    expect(res.summary.page_size).toBe(res.items.length);
    // If we successfully added a lead above, items.length is >= 1; if
    // pull_leads returned nothing (empty account), items.length is 0.
    // Both are valid; the test asserts envelope, not data depth.
    for (const row of res.items) {
      expect(row.lead).toBeTypeOf("object");
      expect(row.progress).toBeTypeOf("object");
      expect(row.affiliation).toBeTypeOf("object");
      expect(Array.isArray(row.affiliation.own_campaigns)).toBe(true);
    }
  });
});
