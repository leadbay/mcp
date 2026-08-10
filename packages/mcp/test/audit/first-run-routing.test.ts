/**
 * Audit: the first-run walkthrough is actually ROUTED to, not merely listed.
 *
 * Observed live (issue leadbay/product#3952): a user typed "Walk me through
 * Leadbay" in Claude Desktop chat and the agent wrote its own product overview
 * instead of invoking `leadbay_getting_started`. The prompt WAS in the catalog
 * — but a bare bullet ~10k chars into a 25k-char instruction block is a listing,
 * not an instruction, and the agent had no reason to prefer it over improvising.
 *
 * The fix is a dedicated FIRST RUN routing line early in the server
 * instructions. These tests pin it: the phrasings, the explicit "invoke the
 * prompt" verb, the "don't improvise" prohibition, and its position ahead of
 * the prompt catalog.
 */

import { describe, it, expect, vi } from "vitest";
import { httpsMockFactory } from "../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "@leadbay/core";
import { buildServer } from "../../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-us.leadbay.app";

async function instructions(): Promise<string> {
  const lbClient = new LeadbayClient(BASE, "u.test-token");
  const server = buildServer(lbClient);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
  return mcpClient.getInstructions() ?? "";
}

describe("audit: first-run routing to the walkthrough", () => {
  it("the instructions carry a FIRST RUN routing line naming the prompt", async () => {
    const ins = await instructions();
    expect(ins).toMatch(/FIRST RUN/);
    expect(ins).toMatch(/leadbay_getting_started/);
  });

  it("it names the phrasings a first-run user actually types", async () => {
    const ins = await instructions();
    // The exact strings from the live failure + the tool's own trigger list.
    for (const phrase of [
      "walk me through Leadbay",
      "I'm new",
      "how do I use this",
      "getting started",
      "give me a tour",
    ]) {
      expect(ins, `first-run phrasing "${phrase}" not routed`).toContain(phrase);
    }
  });

  it("it says INVOKE the prompt, and forbids improvising a tour", async () => {
    const ins = await instructions();
    // Listing the prompt was never the problem — choosing it was.
    expect(ins).toMatch(/invoke the `leadbay_getting_started` prompt via `prompts\/get`/);
    // The exact observed failure: the agent wrote its own overview.
    expect(ins).toMatch(/Do NOT improvise your own overview, tour, or summary/);
  });

  it("the routing line lands BEFORE the prompt catalog listing", async () => {
    const ins = await instructions();
    const routing = ins.indexOf("FIRST RUN");
    const catalog = ins.indexOf("This server exposes the following workflow prompts");
    expect(routing).toBeGreaterThanOrEqual(0);
    expect(catalog).toBeGreaterThanOrEqual(0);
    // A directive buried after a 15-bullet catalog is one the agent reads too
    // late to act on. Order is the whole point of this fix.
    expect(routing).toBeLessThan(catalog);
  });

  it("it explains WHY the walkthrough beats a prose tour", async () => {
    const ins = await instructions();
    // Without the reason, "don't improvise" reads as arbitrary and gets ignored
    // the moment the agent thinks its own summary would be nicer.
    expect(ins).toMatch(/single-option choice widget/);
    expect(ins).toMatch(/learn by doing/);
  });
});
