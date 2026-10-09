/**
 * The `{{apps}}` description variant — what the agent reads about the board.
 *
 * On a surface that serves the Lead Triage Board, leadbay_pull_leads must tell
 * the agent the board IS the rendering, or it redraws the same leads as a
 * markdown table under it. On Claude the sentence must not exist at all: the
 * Claude description stays the exact constant it was before the marker.
 *
 * New file — does not modify server.test.ts or commerce-gate.test.ts.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetHttpMock, httpsMockFactory } from "../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import {
  LeadbayClient,
  compositeReadTools,
  APPS_TOOL_DESCRIPTIONS,
  APPS_NO_COMMERCE_TOOL_DESCRIPTIONS,
} from "@leadbay/core";

// The default constant the tool ships with — what Claude has always read.
const DEFAULT_PULL_LEADS = compositeReadTools.find((t) => t.name === "leadbay_pull_leads")!.description;
import { buildServer } from "../../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-us.leadbay.app";
const BOARD_SENTENCE = "If the host shows the Leadbay board for this call";
const MAX_CHARS = 17_000;

beforeEach(() => resetHttpMock());

async function descriptions(opts: { includeApps?: boolean; includeCommerce?: boolean }) {
  const server = buildServer(new LeadbayClient(BASE, "u.test-token"), { includeWrite: true, ...opts });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([server.connect(st), mcp.connect(ct)]);
  const { tools } = await mcp.listTools();
  return new Map(tools.map((t) => [t.name, t.description ?? ""]));
}

/** `part` reachable from `whole` by deleting characters only. */
function isDeletionOf(part: string, whole: string): boolean {
  let i = 0;
  for (const ch of whole) if (i < part.length && part[i] === ch) i++;
  return i === part.length;
}

describe("leadbay_pull_leads description per surface", () => {
  it("Claude (/mcp): no board sentence, and the exact default constant", async () => {
    const d = (await descriptions({})).get("leadbay_pull_leads")!;
    expect(d).not.toContain(BOARD_SENTENCE);
    expect(d).toBe(DEFAULT_PULL_LEADS);
  });

  it("/apps/mcp (apps, commerce on): carries the board sentence", async () => {
    const d = (await descriptions({ includeApps: true })).get("leadbay_pull_leads")!;
    expect(d).toContain(BOARD_SENTENCE);
    expect(d).toContain("don't also draw the RENDER table");
  });

  it("/chatgpt/mcp (apps, commerce off): carries the board sentence", async () => {
    const d = (await descriptions({ includeApps: true, includeCommerce: false })).get("leadbay_pull_leads")!;
    expect(d).toContain(BOARD_SENTENCE);
  });

  it("the apps variant only ADDS to Claude's — nothing reworded", () => {
    expect(DEFAULT_PULL_LEADS).not.toContain(BOARD_SENTENCE);
    expect(isDeletionOf(DEFAULT_PULL_LEADS, APPS_TOOL_DESCRIPTIONS.leadbay_pull_leads)).toBe(true);
  });

  it("both apps variants stay under the description budget", () => {
    for (const map of [APPS_TOOL_DESCRIPTIONS, APPS_NO_COMMERCE_TOOL_DESCRIPTIONS]) {
      for (const [name, text] of Object.entries(map)) {
        expect(text.length, name).toBeLessThanOrEqual(MAX_CHARS);
      }
    }
  });
});

describe("tools without apps prose are untouched on an apps surface", () => {
  it("every other description on /apps/mcp equals the Claude one", async () => {
    const claude = await descriptions({});
    const apps = await descriptions({ includeApps: true });
    for (const [name, text] of apps) {
      if (name === "leadbay_pull_leads" || name === "leadbay_followups_map") continue;
      expect(text, name).toBe(claude.get(name));
    }
  });

  it("every other description on /chatgpt/mcp equals the commerce-free one", async () => {
    const chatgptBefore = await descriptions({ includeCommerce: false });
    const chatgpt = await descriptions({ includeApps: true, includeCommerce: false });
    for (const [name, text] of chatgpt) {
      if (name === "leadbay_pull_leads" || name === "leadbay_followups_map") continue;
      expect(text, name).toBe(chatgptBefore.get(name));
    }
  });
});
