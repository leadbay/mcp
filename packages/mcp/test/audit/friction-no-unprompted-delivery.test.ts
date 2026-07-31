import { describe, expect, it, vi } from "vitest";
import { httpsMockFactory } from "../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "@leadbay/core";
import { buildServer } from "../../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-us.leadbay.app";

async function descriptions() {
  const lbClient = new LeadbayClient(BASE, "u.test-token", "us");
  const server = buildServer(lbClient, { includeWrite: true });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
  const tools = (await mcpClient.listTools()).tools;
  const byName = (n: string) => tools.find((t) => t.name === n)?.description ?? "";
  return {
    friction: byName("leadbay_report_friction"),
    feedback: byName("leadbay_send_feedback"),
  };
}

/**
 * Bare frustration must not reach ANY delivery tool (product#3943, Codex P2).
 *
 * The first pass at the consent rework routed "frustrated but hasn't asked to
 * report" away from leadbay_report_friction and toward leadbay_send_feedback —
 * but that is also a deliver-to-the-team tool. An agent following the anti-
 * trigger literally could still transmit the user's complaint unprompted, just
 * through a different pipe, which is exactly what WORKFLOWS.md workflow 47
 * forbids and what the MCP-directory review rejected.
 *
 * Both descriptions must therefore say the same thing: venting is not consent.
 */
describe("audit: venting never routes to a delivery tool", () => {
  it("report_friction does not hand bare frustration to another sender", async () => {
    const { friction } = await descriptions();
    expect(friction.length).toBeGreaterThan(0);

    // The anti-trigger for un-asked-for frustration must NOT point at the other
    // delivery tool. Scoped to that one entry: the anti-trigger list is rendered
    // on a single line, so match only up to the entry's own `→ tool` arrow
    // rather than letting it run into the next entry's route.
    const ventEntry = friction.match(
      /frustrated but has not asked to report anything[^→]*→\s*`?([a-z_]+)`?/
    );
    expect(ventEntry).not.toBeNull();
    expect(ventEntry![1]).not.toBe("leadbay_send_feedback");
    expect(ventEntry![1]).not.toBe("leadbay_report_friction");
    // And it must state the rule positively.
    expect(friction).toMatch(/[Vv]enting is not consent/);
    expect(friction).toMatch(/do NOT reach for a delivery tool/i);
  });

  it("send_feedback also refuses to send on bare frustration", async () => {
    const { feedback } = await descriptions();
    expect(feedback.length).toBeGreaterThan(0);
    expect(feedback).toMatch(/[Vv]enting is not consent/);
    expect(feedback).toMatch(/do NOT call this tool/i);
  });
});
