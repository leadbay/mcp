/**
 * A fact about one company is written down as a note (product#4171).
 *
 * A dislike saves its reason as a note (product#4170). A CRM status stores no
 * reason at all, and "GAT agencement, ce sont nos agents commerciaux sur le
 * Sud-Ouest" excludes nothing. Unless the agent writes those facts on the lead
 * with leadbay_add_note, the next session, the scheduled run and the user's
 * colleagues never learn why the company was set aside. Before this change
 * nothing the agent reads said so.
 *
 * Asserted on the surface the host actually receives: the server instructions
 * and the tools/list descriptions of a real buildServer().
 *
 * New file — does not modify server.test.ts.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "@leadbay/core";
import { buildServer } from "../../src/server.js";
import { COMPANY_FACTS, STATED_RULES } from "../../src/server-instructions.generated.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

async function connect(includeWrite: boolean) {
  const client = new LeadbayClient("https://api-us.leadbay.app", "u.test-token");
  const server = buildServer(client, { includeWrite });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)]);
  const tools = (await mcpClient.listTools()).tools;
  return {
    instructions: (server as any)._instructions as string,
    description: (name: string) => tools.find((t) => t.name === name)?.description ?? "",
    names: new Set(tools.map((t) => t.name)),
  };
}

beforeEach(() => resetHttpMock());

describe("product#4171 — a fact about one company is written as a note", () => {
  it("the server instructions tell the agent to write it with leadbay_add_note", async () => {
    mockHttp([]);
    const { instructions } = await connect(true);
    expect(instructions).toContain(COMPANY_FACTS);
    expect(COMPANY_FACTS).toContain("leadbay_add_note");
    expect(COMPANY_FACTS).toContain("A CRM status stores no reason");
    expect(COMPANY_FACTS).toContain("ce sont nos agents commerciaux sur le Sud-Ouest");
    // arthur.pascal's scheduled run found "entité radiée, rachetée par
    // Thinkproject" itself and wrote nothing.
    expect(COMPANY_FACTS).toContain("in a scheduled run");
    // A dislike already saved its reason: no duplicate note.
    expect(COMPANY_FACTS).toContain("a reason already saved by a dislike needs no second note");
    // Sits right after the fit-rule paragraph, which would otherwise send
    // "they're already a client" to a settings proposal.
    expect(instructions.indexOf(COMPANY_FACTS)).toBeGreaterThan(instructions.indexOf(STATED_RULES));
  });

  it("a server without leadbay_add_note never names it in the instructions", async () => {
    mockHttp([]);
    const { instructions, names } = await connect(false);
    expect(names.has("leadbay_add_note")).toBe(false);
    expect(instructions).not.toContain(COMPANY_FACTS);
  });

  it("leadbay_add_note's own description names the case", async () => {
    mockHttp([]);
    const { description } = await connect(true);
    const text = description("leadbay_add_note");
    expect(text).toContain("to record why a company was set aside when a CRM status change carries no reason");
    expect(text).toContain("A dislike saves its own reason: do not add a second note for it.");
  });

  it("the named-company row of the fit-rule table routes the reason to leadbay_add_note", async () => {
    mockHttp([]);
    const { description } = await connect(true);
    for (const tool of [
      "leadbay_get_qualification_questions",
      "leadbay_set_qualification_questions",
      "leadbay_refine_prompt",
    ]) {
      const row = description(tool).split("\n").find((l) => l.startsWith("| Named companies"));
      expect(row, tool).toBeDefined();
      expect(row, tool).toContain("`leadbay_add_note`");
    }
  });
});
