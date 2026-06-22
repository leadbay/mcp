/**
 * Prompts test — verifies the prompts/* capability + canned slash
 * commands.
 */

import { describe, it, expect, vi } from "vitest";
import { httpsMockFactory } from "./harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "@leadbay/core";
import { buildServer } from "../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-us.leadbay.app";

async function connect() {
  const lbClient = new LeadbayClient(BASE, "u.test-token");
  const server = buildServer(lbClient);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
  return { mcpClient };
}

describe("prompts/* capability (P2 prompts)", () => {
  it("prompts/list returns all canned prompts", async () => {
    const { mcpClient } = await connect();
    const listed = await mcpClient.listPrompts();
    const names = listed.prompts.map((p) => p.name);
    expect(names).toEqual([
      "leadbay_daily_check_in",
      "leadbay_prospecting_overview",
      "leadbay_research_a_domain",
      "leadbay_import_file",
      "leadbay_refine_audience",
      "leadbay_log_outreach",
      "leadbay_plan_tour_in_city",
      "leadbay_build_campaign",
      "leadbay_setup_team_prospecting",
      "leadbay_work_campaign",
      "leadbay_qualify_top_n",
    ]);
    // Each prompt has a description.
    for (const p of listed.prompts) {
      expect(p.description).toBeTypeOf("string");
      expect(p.description!.length).toBeGreaterThan(20);
    }
  });

  it("prompts/get(daily_check_in) returns a non-empty user message", async () => {
    const { mcpClient } = await connect();
    const result = await mcpClient.getPrompt({ name: "leadbay_daily_check_in" });
    expect(result.messages.length).toBeGreaterThanOrEqual(1);
    expect(result.messages[0].role).toBe("user");
    const content = result.messages[0].content as any;
    expect(content.type).toBe("text");
    expect(content.text).toContain("leadbay_account_status");
    expect(content.text).toContain("leadbay_pull_leads");
  });

  it("prompts/get(research_a_domain) interpolates the domain argument", async () => {
    const { mcpClient } = await connect();
    const result = await mcpClient.getPrompt({
      name: "leadbay_research_a_domain",
      arguments: { domain: "acme.com" },
    });
    const text = (result.messages[0].content as any).text;
    expect(text).toContain("acme.com");
    expect(text).toContain("leadbay_import_and_qualify");
  });

  it("prompts/get(import_file) teaches resolve-disambiguate-import flow", async () => {
    const { mcpClient } = await connect();
    const result = await mcpClient.getPrompt({
      name: "leadbay_import_file",
      arguments: { file: "leads.csv", instruction: "then qualify them" },
    });
    const text = (result.messages[0].content as any).text;
    expect(text).toContain("leads.csv");
    expect(text).toContain("leadbay_resolve_import_rows");
    expect(text).toContain("include_candidate_profiles");
    expect(text).toContain("leadbay_import_and_qualify");
    // Disambiguation guardrail (prose updated 2026-05-15: "Never **pick**
    // LEADBAY_ID from score alone..." replaced "Never choose from score alone").
    expect(text).toContain("score alone");
    expect(text).toContain("business domain");
    expect(text).toContain("CONTACT_EMAIL");
    expect(text).toContain("leadbay_create_custom_field");
    expect(text).toContain("EXTERNAL_ID");
    // The CRM record link snippet now lists multiple CRMs by name; the
    // assertion checks at least one of them appears (HubSpot is the canonical
    // first example).
    expect(text).toContain("HubSpot");
    expect(text).toContain("Salesforce");
    // The new GOAL section explicitly teaches what a job-well-done looks like.
    expect(text).toContain("augmented file");
  });

  it("prompts/get(work_campaign) keeps omitted mode as readiness-first", async () => {
    const { mcpClient } = await connect();
    const listed = await mcpClient.listPrompts();
    const workCampaign = listed.prompts.find((p) => p.name === "leadbay_work_campaign");
    expect(workCampaign?.arguments?.find((a) => a.name === "mode")?.description).toContain("email_sheet");
    expect(workCampaign?.arguments?.find((a) => a.name === "mode")?.description).toContain("enrich_first");

    const defaultResult = await mcpClient.getPrompt({
      name: "leadbay_work_campaign",
      arguments: { campaign: "Q2 Push" },
    });
    const defaultText = (defaultResult.messages[0].content as any).text;
    expect(defaultText).toContain("Work my **Q2 Push** campaign as an outreach session.");
    expect(defaultText).toContain("do not treat `call_sheet` as implicit user consent");
    expect(defaultText).toContain("leadbay_enrich_titles({leadIds");
    expect(defaultText).not.toContain("leadbay_enrich_titles({campaign_id");

    const mapResult = await mcpClient.getPrompt({
      name: "leadbay_work_campaign",
      arguments: { campaign: "Q2 Push", mode: "map" },
    });
    const mapText = (mapResult.messages[0].content as any).text;
    expect(mapText).toContain("Work my **Q2 Push** campaign as an outreach session (mode: map).");
  });

  it("prompts/get with missing required argument errors", async () => {
    const { mcpClient } = await connect();
    let threw = false;
    try {
      await mcpClient.getPrompt({
        name: "leadbay_research_a_domain",
        arguments: {},
      });
    } catch (err: any) {
      threw = true;
      expect(String(err)).toContain("domain");
    }
    expect(threw).toBe(true);
  });

  it("prompts/get(unknown) errors", async () => {
    const { mcpClient } = await connect();
    let threw = false;
    try {
      await mcpClient.getPrompt({ name: "leadbay_no_such_prompt" });
    } catch (err: any) {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
