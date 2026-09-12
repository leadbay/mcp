/**
 * Audit: nothing the agent reads presents Leadbay's own work as a bill.
 *
 * A user on a subscription or a top-up has already paid for the AI work this
 * server runs. Descriptions that quoted per-lead prices, rendered usage in
 * dollars, or called a reveal "paid" made agents tell those users what an
 * action "costs" and that it would be "billed", which reads as overspending.
 * Usage is shown as a share of the plan's quota, never as money.
 *
 * The two tools whose job IS buying (top-ups, the billing portal) are exempt.
 *
 * New file.
 */

import { describe, it, expect, vi } from "vitest";
import { mockHttp, httpsMockFactory } from "../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "@leadbay/core";
import { buildServer } from "../../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import * as PROMPTS from "../../src/prompts.generated.js";

const BASE = "https://api-us.leadbay.app";
const BUYING_TOOLS = new Set(["leadbay_create_topup_link", "leadbay_open_billing_portal"]);

// Each pattern is wording that made an agent speak of Leadbay usage as money.
// The account-status quota gauge ($ used of $ cap) is exempt: there the context
// says it is a quota, so dollars read as a share of the plan, not a bill.
const BILL_FRAMING: RegExp[] = [
  /spent C\.CC/i,
  /\bPAID\b/,
  /\bpaid (reveal|launch|run|call|pass|search|enrichment|action|work|depth|submit)\b/i,
  /\bspend (decision|confirmation|quota|risk)\b|\bspends? nothing\b|\bno spend\b|never spend silently|double[- ]spend/i,
  /\bone credit\b|\bcosts credits\b/i,
  /in plain money|worst-case cost|in the account's currency|misstates a charge/i,
  /\bbilled\b/i,
  /\bcharg(e|es|ing) for\b/i,
  /~\d+ cost_cents|\b(email|phone) ~?\d+c\b/i,
];

async function surfaces(): Promise<Array<[string, string]>> {
  mockHttp([]);
  const server = buildServer(new LeadbayClient(BASE, "u.test-token"), {
    includeWrite: true,
    includeAdvanced: true,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  const out: Array<[string, string]> = [];
  for (const t of (await client.listTools()).tools) {
    if (BUYING_TOOLS.has(t.name)) continue;
    out.push([`tool ${t.name}`, t.description ?? ""]);
    out.push([`input schema ${t.name}`, JSON.stringify(t.inputSchema ?? {})]);
    out.push([`output schema ${t.name}`, JSON.stringify((t as any).outputSchema ?? {})]);
  }
  out.push(["server instructions", ((server as any)._instructions as string) ?? ""]);
  for (const [name, value] of Object.entries(PROMPTS)) {
    out.push([`prompt ${name}`, typeof value === "string" ? value : JSON.stringify(value)]);
  }
  return out;
}

describe("audit: no billing framing", () => {
  it("no tool, schema, prompt or instruction speaks of Leadbay usage as money", async () => {
    const offenders: string[] = [];
    for (const [where, text] of await surfaces()) {
      for (const re of BILL_FRAMING) {
        const m = text.match(re);
        if (m) offenders.push(`${where}: "${m[0]}"`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
