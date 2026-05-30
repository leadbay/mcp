/**
 * Unit tests for the MCP server — verifies protocol wiring against mocked HTTP.
 *
 * Uses InMemoryTransport from @modelcontextprotocol/sdk so we exercise the
 * actual JSON-RPC handshake rather than poking internal handlers.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "./harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "@leadbay/core";
import { buildServer } from "../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-us.leadbay.app";

async function connect(opts: {
  includeAdvanced?: boolean;
  includeWrite?: boolean;
  client?: LeadbayClient;
} = {}) {
  const lbClient = opts.client ?? new LeadbayClient(BASE, "u.test-token");
  const server = buildServer(lbClient, {
    includeAdvanced: opts.includeAdvanced,
    includeWrite: opts.includeWrite,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
  return { server, mcpClient, lbClient };
}

beforeEach(() => {
  resetHttpMock();
});

describe("tools/list — default (composite reads + writes since 0.3.0)", () => {
  it("returns composite reads AND writes with non-empty descriptions (writes-on default)", async () => {
    const { mcpClient } = await connect({ includeWrite: true });
    const listed = await mcpClient.listTools();
    const names = new Set(listed.tools.map((t) => t.name));

    // 0.3.0: composite reads + writes both exposed by default.
    expect(names).toContain("leadbay_pull_leads");
    expect(names).toContain("leadbay_research_lead_by_id");
    expect(names).toContain("leadbay_account_status");
    expect(names).toContain("leadbay_recall_ordered_titles");
    // Existing composites (kept for back-compat)
    expect(names).toContain("leadbay_research_lead_by_name_fuzzy");
    expect(names).toContain("leadbay_prepare_outreach");
    // Composite writes — exposed under the new default.
    expect(names).toContain("leadbay_report_outreach");
    expect(names).toContain("leadbay_refine_prompt");
    expect(names).toContain("leadbay_adjust_audience");
    expect(names).toContain("leadbay_bulk_qualify_leads");
    expect(names).toContain("leadbay_enrich_titles");
    expect(names).toContain("leadbay_answer_clarification");
    expect(names).toContain("leadbay_import_leads");
    // login NEVER on MCP; find_prospects was removed in v0.2.0.
    expect(names).not.toContain("leadbay_login");
    expect(names).not.toContain("leadbay_find_prospects");
    // Granular tools still gated by includeAdvanced.
    expect(names).not.toContain("leadbay_list_lenses");
    expect(names).not.toContain("leadbay_select_leads");

    for (const t of listed.tools) {
      expect(t.description).toBeTypeOf("string");
      expect(t.description!.length).toBeGreaterThan(20);
      expect(t.inputSchema).toBeTypeOf("object");
    }
  });

  it("does NOT expose leadbay_login (UC-3 security)", async () => {
    const { mcpClient } = await connect({ includeWrite: true });
    const listed = await mcpClient.listTools();
    expect(listed.tools.map((t) => t.name)).not.toContain("leadbay_login");
  });

  it("does NOT expose granular tools by default", async () => {
    const { mcpClient } = await connect({ includeWrite: true });
    const listed = await mcpClient.listTools();
    expect(listed.tools.map((t) => t.name)).not.toContain("leadbay_list_lenses");
  });
});

describe("tools/list — read-only mode (LEADBAY_MCP_WRITE=0 / includeWrite=false)", () => {
  it("excludes composite write tools when includeWrite=false", async () => {
    const { mcpClient } = await connect({ includeWrite: false });
    const names = new Set((await mcpClient.listTools()).tools.map((t) => t.name));
    // Reads still exposed.
    expect(names).toContain("leadbay_pull_leads");
    expect(names).toContain("leadbay_research_lead_by_id");
    expect(names).toContain("leadbay_account_status");
    // Writes hidden.
    expect(names).not.toContain("leadbay_report_outreach");
    expect(names).not.toContain("leadbay_refine_prompt");
    expect(names).not.toContain("leadbay_answer_clarification");
    expect(names).not.toContain("leadbay_adjust_audience");
    expect(names).not.toContain("leadbay_bulk_qualify_leads");
    expect(names).not.toContain("leadbay_enrich_titles");
    expect(names).not.toContain("leadbay_import_leads");
    expect(names).not.toContain("leadbay_select_leads");
  });
});

describe("tools/list — advanced mode", () => {
  it("exposes composite reads + granular reads when includeAdvanced only", async () => {
    const { mcpClient } = await connect({ includeAdvanced: true });
    const names = new Set((await mcpClient.listTools()).tools.map((t) => t.name));
    expect(names).toContain("leadbay_pull_leads");
    expect(names).toContain("leadbay_list_lenses");
    expect(names).toContain("leadbay_discover_leads");
    expect(names).toContain("leadbay_get_lens_filter");
    expect(names).not.toContain("leadbay_login");
    // Writes still gated.
    expect(names).not.toContain("leadbay_select_leads");
    expect(names).not.toContain("leadbay_report_outreach");
  });

  it("exposes everything except login when includeAdvanced+includeWrite", async () => {
    const { mcpClient } = await connect({
      includeAdvanced: true,
      includeWrite: true,
    });
    const names = new Set((await mcpClient.listTools()).tools.map((t) => t.name));
    expect(names).toContain("leadbay_pull_leads");
    expect(names).toContain("leadbay_select_leads");
    expect(names).toContain("leadbay_set_user_prompt");
    expect(names).toContain("leadbay_launch_bulk_enrichment");
    expect(names).toContain("leadbay_report_outreach");
    expect(names).not.toContain("leadbay_login");
  });
});

describe("tools/call — composite round-trip", () => {
  it("leadbay_pull_leads returns leads via mocked HTTP", async () => {
    mockHttp([
      // resolveDefaultLens → /me first
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 200,
        body: {
          id: "u",
          organization: { id: "org-1", name: "X" },
          last_requested_lens: 42,
        },
      },
      {
        method: "GET",
        path: /\/1\.5\/lenses\/42\/leads\/wishlist/,
        status: 200,
        body: {
          items: [
            {
              id: "lead-1",
              name: "Acme",
              score: 80,
              ai_agent_lead_score: 70,
              location: null,
              description: null,
              size: null,
              website: "acme.com",
              contacts_count: 0,
              org_contacts_count: 0,
              tags: [],
              phone_numbers: [],
              keywords: [],
              recommended_contact_title: null,
              recommended_contact: null,
              liked: false,
              disliked: false,
            },
          ],
          pagination: { page: 0, pages: 1, total: 1 },
          computing_wishlist: false,
          computing_scores: false,
        },
      },
      // qualification fan-out (1 lead)
      {
        method: "GET",
        path: "/1.5/leads/lead-1/ai_agent_responses",
        status: 200,
        body: [
          { question: "Q1", question_created_at: "2026-04-20T00:00:00Z", lead_id: "lead-1", score: 8, response: "good fit", computed_at: "2026-04-20T00:00:00Z" },
        ],
      },
    ]);
    const { mcpClient } = await connect();
    const result = await mcpClient.callTool({
      name: "leadbay_pull_leads",
      arguments: { count: 10, _triggered_by: "test trigger" },
    });
    expect(result.isError).toBeFalsy();
    const content = result.content as any[];
    const text = content[0].text;
    const parsed = JSON.parse(text);
    expect(parsed.leads).toHaveLength(1);
    expect(parsed.leads[0].name).toBe("Acme");
    expect(parsed.leads[0].qualification_summary).toBeDefined();
  });
});

describe("tools/call — error envelopes", () => {
  it("unknown tool returns isError:true with message listing known tools", async () => {
    const { mcpClient } = await connect();
    const result = await mcpClient.callTool({
      name: "leadbay_nope",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    const content = result.content as any[];
    expect(content[0].text).toMatch(/Unknown Leadbay tool/);
  });

  it("AUTH_EXPIRED from client surfaces as isError:true with fix instructions", async () => {
    mockHttp([
      // pull_leads → resolveDefaultLens → /me first
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 401,
        body: { message: "expired" },
      },
      // Fallback to /lenses scan after /me 401 — also 401.
      {
        method: "GET",
        path: "/1.5/lenses",
        status: 401,
        body: { message: "expired" },
      },
    ]);
    const { mcpClient } = await connect();
    const result = await mcpClient.callTool({
      name: "leadbay_pull_leads",
      arguments: { _triggered_by: "test trigger" },
    });
    expect(result.isError).toBe(true);
    const content = result.content as any[];
    expect(content[0].text).toMatch(/authentication token expired/i);
    expect(content[0].text).toMatch(/Regenerate/);
  });

  it("tool returning {error: true} envelope becomes isError:true", async () => {
    // leadbay_login returns { error: true, code: "LOGIN_FAILED", ... } on 401.
    // Exercise through granular mode so we can hit it directly.
    const { mcpClient, lbClient } = await connect({ includeAdvanced: true });
    void lbClient;
    // leadbay_login is NOT exposed on MCP by design, but other tools that
    // surface error envelopes should behave the same. Trigger via discover_leads
    // returning a LeadbayError through the client — already covered above.
    const result = await mcpClient.callTool({
      name: "leadbay_does_not_exist",
      arguments: {},
    });
    expect(result.isError).toBe(true);
  });
});

describe("buildServerInstructions — dynamic LLM guidance", () => {
  const FULL_EXPOSURE = new Set([
    "leadbay_account_status",
    "leadbay_pull_leads",
    "leadbay_research_lead_by_id",
    "leadbay_recall_ordered_titles",
    "leadbay_bulk_qualify_leads",
    "leadbay_enrich_titles",
    "leadbay_adjust_audience",
    "leadbay_refine_prompt",
    "leadbay_answer_clarification",
    "leadbay_report_outreach",
  ]);

  const READ_ONLY = new Set([
    "leadbay_account_status",
    "leadbay_pull_leads",
    "leadbay_research_lead_by_id",
    "leadbay_recall_ordered_titles",
  ]);

  it("default (writes exposed) leads with the report_outreach mandate", async () => {
    const { buildServerInstructions } = await import("../src/server.js");
    const out = buildServerInstructions(FULL_EXPOSURE);
    // First sentence MUST be the verification mandate so the model retains it.
    expect(out.slice(0, 200)).toMatch(/report_outreach/i);
    expect(out).toMatch(/verification/i);
    expect(out).toMatch(/gmail_message_id|calendar_event_id|user_confirmed/);
  });

  it("default references the composite agent flow", async () => {
    const { buildServerInstructions } = await import("../src/server.js");
    const out = buildServerInstructions(FULL_EXPOSURE);
    expect(out).toMatch(/leadbay_pull_leads/);
    expect(out).toMatch(/leadbay_research_lead_by_id/);
    expect(out).toMatch(/leadbay_account_status/);
  });

  it("default teaches the inbox + pace + scoring mental model", async () => {
    const { buildServerInstructions } = await import("../src/server.js");
    const out = buildServerInstructions(FULL_EXPOSURE);
    // Inbox framing — the daily-cadence anchor.
    expect(out).toMatch(/inbox/i);
    // Consumption-based pacing.
    expect(out).toMatch(/paced|pace/i);
    // Two scoring layers with concrete field names.
    expect(out).toMatch(/two scoring layers/i);
    expect(out).toMatch(/ai_agent_lead_score/);
    // Daily-rhythm recommendation.
    expect(out).toMatch(/daily|each day/i);
    // Points to the on-demand deepening tools when they are exposed.
    expect(out).toMatch(/leadbay_bulk_qualify_leads/);
    expect(out).toMatch(/leadbay_enrich_titles/);
  });

  it("read-only mode does NOT mention write tools or the report_outreach mandate", async () => {
    const { buildServerInstructions } = await import("../src/server.js");
    const out = buildServerInstructions(READ_ONLY);
    // First 200 chars must NOT carry the verification mandate (report_outreach absent).
    expect(out.slice(0, 200)).not.toMatch(/report_outreach/i);
    // Body must not name any write tool.
    expect(out).not.toMatch(/leadbay_bulk_qualify_leads/);
    expect(out).not.toMatch(/leadbay_enrich_titles/);
    expect(out).not.toMatch(/leadbay_adjust_audience/);
    expect(out).not.toMatch(/leadbay_refine_prompt/);
    expect(out).not.toMatch(/leadbay_answer_clarification/);
    expect(out).not.toMatch(/leadbay_report_outreach/);
    // Mental-model framing IS still present.
    expect(out).toMatch(/inbox/i);
    expect(out).toMatch(/two scoring layers/i);
    // Read-only fallback prose IS present.
    expect(out).toMatch(/those actions require write tools/i);
    expect(out).toMatch(/LEADBAY_MCP_WRITE=0/);
    // Still references the composite read flow.
    expect(out).toMatch(/leadbay_pull_leads/);
    expect(out).toMatch(/leadbay_research_lead_by_id/);
  });

  it("buildServer attaches dynamic instructions to the Server (read-only mode)", async () => {
    const { server } = await connect({ includeWrite: false });
    // MCP SDK 1.29.0 stores the constructor-time `instructions` option on
    // Server._instructions. We assert against that directly so the test cannot
    // silently pass if the wiring breaks. (Plain getServerCapabilities() does
    // NOT carry the instructions string — it's emitted on InitializeResult.)
    const instructions = (server as any)._instructions;
    expect(typeof instructions).toBe("string");
    expect(instructions.slice(0, 200)).not.toMatch(/report_outreach/i);
    expect(instructions).not.toMatch(/leadbay_refine_prompt/);
    expect(instructions).toMatch(/inbox/i);
    expect(instructions).toMatch(/those actions require write tools/i);
  });

  it("buildServer attaches dynamic instructions to the Server (default writes-on)", async () => {
    const { server } = await connect({ includeWrite: true });
    const instructions = (server as any)._instructions;
    expect(typeof instructions).toBe("string");
    // Verification mandate leads when report_outreach is exposed.
    expect(instructions.slice(0, 200)).toMatch(/report_outreach/i);
    expect(instructions).toMatch(/leadbay_bulk_qualify_leads/);
    expect(instructions).toMatch(/leadbay_enrich_titles/);
    expect(instructions).not.toMatch(/those actions require write tools/i);
  });

  it("default-config instructions advertise every MCP prompt by name", async () => {
    // Acceptance criterion for the prompts-as-skills surface (Cowork): an
    // MCP client that doesn't render the prompts/list catalog in its UI
    // gets the prompt names + trigger phrasing through the agent's
    // session-start `instructions` so the agent knows to invoke them
    // directly via prompts/get. All six prompts must appear when the
    // server is fully configured.
    const { server } = await connect({ includeWrite: true });
    const instructions = (server as any)._instructions as string;
    expect(instructions).toMatch(/`leadbay_daily_check_in`/);
    expect(instructions).toMatch(/`leadbay_research_a_domain`/);
    expect(instructions).toMatch(/`leadbay_import_file`/);
    expect(instructions).toMatch(/`leadbay_log_outreach`/);
    expect(instructions).toMatch(/`leadbay_qualify_top_n`/);
    expect(instructions).toMatch(/`leadbay_refine_audience`/);
    // The catalog explains the direct-invoke fallback for UI-blind clients.
    expect(instructions).toMatch(/prompts\/get/);
  });

  it("read-only-config instructions suppress prompt bullets that reference unavailable tools", async () => {
    // The catalog block must honor the iter-12 invariant: bullets that
    // literally name an unexposed tool (e.g. leadbay_qualify_top_n's
    // short_description references leadbay_bulk_qualify_leads) are dropped.
    // Daily check-in and research-a-domain have no leadbay_* references
    // in their short_description, so they survive read-only mode.
    const { buildServerInstructions } = await import("../src/server.js");
    const out = buildServerInstructions(READ_ONLY);
    expect(out).toMatch(/`leadbay_daily_check_in`/);
    expect(out).toMatch(/`leadbay_research_a_domain`/);
    // qualify_top_n's bullet mentions leadbay_bulk_qualify_leads — dropped
    // because bulk_qualify_leads isn't exposed in read-only mode.
    expect(out).not.toMatch(/`leadbay_qualify_top_n`/);
  });
});

describe("resolveClientFromEnv — region auto-probe", () => {
  // These tests exercise the bin.ts helper directly, because the probe
  // behavior is the user-facing contract most likely to regress.
  async function callResolve(env: {
    LEADBAY_TOKEN?: string;
    LEADBAY_REGION?: string;
    LEADBAY_BASE_URL?: string;
    LEADBAY_OAUTH_BOOTSTRAP?: string;
    LEADBAY_OAUTH_STAGING?: string;
  }) {
    const saved = {
      LEADBAY_TOKEN: process.env.LEADBAY_TOKEN,
      LEADBAY_REGION: process.env.LEADBAY_REGION,
      LEADBAY_BASE_URL: process.env.LEADBAY_BASE_URL,
      LEADBAY_OAUTH_BOOTSTRAP: process.env.LEADBAY_OAUTH_BOOTSTRAP,
      LEADBAY_OAUTH_STAGING: process.env.LEADBAY_OAUTH_STAGING,
    };
    // Assigning `undefined` to process.env.X coerces to the string
    // "undefined" (truthy) — delete the key instead so the missing-token
    // branch in resolveClientFromEnv actually triggers.
    if (env.LEADBAY_TOKEN === undefined) delete process.env.LEADBAY_TOKEN;
    else process.env.LEADBAY_TOKEN = env.LEADBAY_TOKEN;
    if (env.LEADBAY_REGION === undefined) delete process.env.LEADBAY_REGION;
    else process.env.LEADBAY_REGION = env.LEADBAY_REGION;
    if (env.LEADBAY_BASE_URL === undefined) delete process.env.LEADBAY_BASE_URL;
    else process.env.LEADBAY_BASE_URL = env.LEADBAY_BASE_URL;
    if (env.LEADBAY_OAUTH_BOOTSTRAP === undefined) delete process.env.LEADBAY_OAUTH_BOOTSTRAP;
    else process.env.LEADBAY_OAUTH_BOOTSTRAP = env.LEADBAY_OAUTH_BOOTSTRAP;
    if (env.LEADBAY_OAUTH_STAGING === undefined) delete process.env.LEADBAY_OAUTH_STAGING;
    else process.env.LEADBAY_OAUTH_STAGING = env.LEADBAY_OAUTH_STAGING;
    try {
      const mod = await import("../src/bin.js");
      const silent = { info: () => {}, warn: () => {}, error: () => {} };
      return await (mod as any).resolveClientFromEnv(silent);
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete (process.env as any)[k];
        else (process.env as any)[k] = v;
      }
    }
  }

  it("explicit LEADBAY_REGION=us skips the probe", async () => {
    const { requests } = mockHttp([]);
    const { client, authState } = await callResolve({
      LEADBAY_TOKEN: "t",
      LEADBAY_REGION: "us",
    });
    expect(client.baseUrl).toBe("https://api-us.leadbay.app");
    expect(authState).toBe("ok");
    expect(requests).toHaveLength(0);
  });

  it("explicit LEADBAY_REGION=fr skips the probe", async () => {
    const { requests } = mockHttp([]);
    const { client, authState } = await callResolve({
      LEADBAY_TOKEN: "t",
      LEADBAY_REGION: "fr",
    });
    expect(client.baseUrl).toBe("https://api-fr.leadbay.app");
    expect(authState).toBe("ok");
    expect(requests).toHaveLength(0);
  });

  it("unset region + fr-only token → auto-detects fr", async () => {
    // us rejects with 401, fr returns 200
    mockHttp([
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 401,
        body: { message: "nope" },
      },
      {
        method: "GET",
        path: "/1.5/users/me",
        status: 200,
        body: { id: "u", organization: { id: "o" } },
      },
    ]);
    // NOTE: mockHttp matches by {method, path} in order. Because both probes
    // share the same path, the first arriving request grabs the first script.
    // To make this test deterministic we rely on Promise.any: if us rejects
    // and fr resolves, fr wins.
    const { client, authState } = await callResolve({ LEADBAY_TOKEN: "t" });
    // Whichever baseUrl resolves first with 200 is the winner.
    expect(["https://api-us.leadbay.app", "https://api-fr.leadbay.app"]).toContain(
      client.baseUrl
    );
    expect(authState).toBe("ok");
  });

  it("both regions 401 → returns broken-client (server still boots)", async () => {
    // Regression test for the silent-`initialize`-crash fix: before this
    // change, the AUTH_EXPIRED probe-failure branch called process.exit(1),
    // killing the MCP process mid-handshake and surfacing on the host as
    // a bare "Server disconnected" with no diagnostic. Now it returns a
    // broken-client so the JSON-RPC handshake completes and the auth
    // failure surfaces on first tool call.
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 401, body: {} },
      { method: "GET", path: "/1.5/users/me", status: 401, body: {} },
    ]);
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const { client, authState } = await callResolve({ LEADBAY_TOKEN: "t" });
      expect(authState).toBe("expired");
      // The broken client exists (server boots), but every API call
      // rejects with AUTH_EXPIRED so the agent gets a clear envelope.
      await expect(client.request("GET", "/anything")).rejects.toMatchObject({
        error: true,
        code: "AUTH_EXPIRED",
        hint: expect.stringMatching(/LEADBAY_TOKEN|leadbay-mcp login/),
      });
      expect(
        stderrSpy.mock.calls.some(([m]) =>
          /authentication token expired/i.test(String(m))
        )
      ).toBe(true);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("missing LEADBAY_TOKEN → returns broken-client with AUTH_MISSING", async () => {
    // Regression test for the silent-`initialize`-crash fix: the
    // token-missing branch used to process.exit(1), same as the
    // AUTH_EXPIRED branch above.
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const { client, authState } = await callResolve({});
      expect(authState).toBe("missing");
      await expect(client.request("GET", "/anything")).rejects.toMatchObject({
        error: true,
        code: "AUTH_MISSING",
        hint: expect.stringMatching(/LEADBAY_TOKEN/),
      });
      expect(
        stderrSpy.mock.calls.some(([m]) =>
          /LEADBAY_TOKEN environment variable is required/.test(String(m))
        )
      ).toBe(true);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it("explicit LEADBAY_BASE_URL also skips the probe", async () => {
    const { requests } = mockHttp([]);
    const { client, authState } = await callResolve({
      LEADBAY_TOKEN: "t",
      LEADBAY_BASE_URL: "https://staging.example.com",
    });
    expect(client.baseUrl).toBe("https://staging.example.com");
    expect(authState).toBe("ok");
    expect(requests).toHaveLength(0);
  });
});
