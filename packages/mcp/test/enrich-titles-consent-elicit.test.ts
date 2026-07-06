/**
 * Production-path proof for the #3848 enrich_titles consent gate.
 *
 * The unit mirror (packages/core/test/unit/composite/enrich-titles-consent-gate.test.ts)
 * drives enrichTitles.execute with a MOCKED ctx.elicit. This test closes the
 * remaining gap: it wires the REAL server (buildServer) to a real MCP client
 * over the in-memory transport and exercises the actual elicitation/create
 * round-trip — proving that (a) buildServer passes a live ctx.elicit into
 * enrich_titles, and (b) the client's accept/decline actually flips the launch.
 *
 * Mirrors the harness in test/elicit.test.ts (new file — existing test files
 * are never modified).
 */

import { describe, it, expect, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "./harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "@leadbay/core";
import { buildServer } from "../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const BASE = "https://api-us.leadbay.app";
const LENS_ID = 88;
const TITLE = "VP of Sales";

// The consent gate uses two lock phases (product#3848 review): phase 1 previews
// (select → job_titles → preview → clear); phase 2 launches on consent
// (select → launch → clear). So a launch path issues a SECOND select + clear.
// The harness matches by (method, path) among unconsumed scripts regardless of
// order, so declaring the right multiplicity is what matters. A /launch fixture
// is added only for launch cases; an unexpected launch on the decline case hits
// an undeclared endpoint and fails loudly. Several /users/me scripts are
// provided because the server + readCreditsRemaining may read it more than once.
const meScript = () => ({
  method: "GET",
  path: "/1.6/users/me",
  status: 200,
  body: {
    id: "u",
    email: "a@b.com",
    organization: { id: "org-1", billing: { ai_credits: 500 } },
    last_requested_lens: LENS_ID,
  },
});

function enrichFlow(opts: { withLaunch?: boolean } = {}) {
  const seq: any[] = [
    meScript(),
    meScript(),
    // phase 1: preview under the lock
    { method: "POST", path: /\/1\.6\/leads\/selection\/select/, status: 204 },
    {
      method: "GET",
      path: "/1.6/leads/selection/enrichment/job_titles",
      status: 200,
      body: [TITLE],
    },
    {
      method: "POST",
      path: "/1.6/leads/selection/enrichment/preview",
      status: 200,
      body: {
        enrichable_contacts: 12,
        title_suggestions: [],
        auto_included_titles: [],
        previously_enriched_titles: [],
      },
    },
    { method: "POST", path: "/1.6/leads/selection/clear", status: 204 },
  ];
  if (opts.withLaunch) {
    // phase 2: re-select → launch → clear, under a fresh lock
    seq.push(
      { method: "POST", path: /\/1\.6\/leads\/selection\/select/, status: 204 },
      {
        method: "POST",
        path: "/1.6/leads/selection/enrichment/launch",
        status: 204,
      },
      { method: "POST", path: "/1.6/leads/selection/clear", status: 204 }
    );
  }
  return mockHttp(seq);
}

async function connectedClient(handler: (req: any) => Promise<any>) {
  const lbClient = new LeadbayClient(BASE, "u.test-token");
  const server = buildServer(lbClient, { includeWrite: true });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client(
    { name: "test", version: "0.0.1" },
    { capabilities: { elicitation: {} } }
  );
  mcpClient.setRequestHandler(ElicitRequestSchema, handler);
  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
  return mcpClient;
}

function launchRequests(requests: { path: string }[]) {
  return requests.filter((r) => /\/enrichment\/launch/.test(r.path));
}

describe("enrich_titles consent gate — real server elicitation round-trip (#3848)", () => {
  it("client DECLINES the paid enrichment → needs_confirmation, NO /launch", async () => {
    resetHttpMock();
    const { requests } = enrichFlow();
    let elicited = false;
    const mcpClient = await connectedClient(async (req) => {
      elicited = true;
      // The prompt the server sends must actually name the spend.
      expect(String(req.params.message)).toMatch(/enrich/i);
      return { action: "decline" };
    });

    const result = await mcpClient.callTool({
      name: "leadbay_enrich_titles",
      arguments: {
        titles: [TITLE],
        lensId: LENS_ID,
        leadIds: ["lead-a", "lead-b"],
        _triggered_by: "add title and LinkedIn to these contacts",
      },
    });

    expect((result as any).isError).not.toBe(true);
    const parsed = JSON.parse((result as any).content[0].text);
    expect(elicited).toBe(true);
    expect(parsed.mode).toBe("needs_confirmation");
    expect(parsed.launched).toBe(false);
    // The load-bearing production assertion: no paid launch was POSTed.
    expect(launchRequests(requests)).toHaveLength(0);
  });

  it("client ACCEPTS → the paid enrichment launches", async () => {
    resetHttpMock();
    const { requests } = enrichFlow({ withLaunch: true });
    const mcpClient = await connectedClient(async () => ({
      action: "accept",
      content: { confirm: true },
    }));

    const result = await mcpClient.callTool({
      name: "leadbay_enrich_titles",
      arguments: {
        titles: [TITLE],
        lensId: LENS_ID,
        leadIds: ["lead-a", "lead-b"],
        _triggered_by: "go ahead and spend, enrich their emails",
      },
    });

    expect((result as any).isError).not.toBe(true);
    const parsed = JSON.parse((result as any).content[0].text);
    expect(parsed.mode).toBe("launched");
    expect(parsed.launched).toBe(true);
    expect(launchRequests(requests)).toHaveLength(1);
  });

  it("explicit email:true launches without eliciting (consent flow preserved)", async () => {
    resetHttpMock();
    const { requests } = enrichFlow({ withLaunch: true });
    let elicited = false;
    const mcpClient = await connectedClient(async () => {
      elicited = true;
      return { action: "decline" };
    });

    const result = await mcpClient.callTool({
      name: "leadbay_enrich_titles",
      arguments: {
        titles: [TITLE],
        lensId: LENS_ID,
        leadIds: ["lead-a"],
        email: true,
        _triggered_by: "enrich the emails for these contacts",
      },
    });

    expect((result as any).isError).not.toBe(true);
    const parsed = JSON.parse((result as any).content[0].text);
    expect(elicited).toBe(false); // explicit channel = consent, no prompt
    expect(parsed.mode).toBe("launched");
    expect(launchRequests(requests)).toHaveLength(1);
  });
});
