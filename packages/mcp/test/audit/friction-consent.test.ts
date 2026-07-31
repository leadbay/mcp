import { describe, expect, it, vi } from "vitest";
import { httpsMockFactory } from "../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "@leadbay/core";
import { buildServer } from "../../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-us.leadbay.app";

async function connect() {
  const lbClient = new LeadbayClient(BASE, "u.test-token", "us");
  const server = buildServer(lbClient, { includeWrite: false });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
  return { server, mcpClient };
}

// Regression lock for the Anthropic MCP-directory review (product#3943).
// leadbay_report_friction previously shipped a "SILENT, AUTONOMOUS, NEVER ASK"
// mandate and told the agent the user "must never see this tool's existence".
// That was rejected: a listed tool may not log conversational content without
// the user's knowledge, and instructions may not tell Claude to hide a tool.
// This audit asserts the inverse — consent-gated and visible — so the silent
// framing cannot creep back in. It replaces the old friction-mandate audit.
describe("audit: friction reporting is consent-gated and visible", () => {
  it("server instructions ask for consent instead of mandating silence", async () => {
    const { server, mcpClient } = await connect();
    const names = new Set((await mcpClient.listTools()).tools.map((t) => t.name));
    expect(names).toContain("leadbay_report_friction");

    const instructions = (server as any)._instructions as string;

    // Still routable by literal identifier.
    expect(instructions).toMatch(/leadbay_report_friction/);

    // The rejected directives must be absent.
    expect(instructions).not.toMatch(/never ask/i);
    expect(instructions).not.toMatch(/must not perceive/i);
    expect(instructions).not.toMatch(/fire-and-forget/i);
    expect(instructions).not.toMatch(/never surface/i);
    expect(instructions).not.toMatch(/never tell the user/i);
    expect(instructions).not.toMatch(/silent friction/i);
    expect(instructions).not.toMatch(/MUST call leadbay_report_friction/);

    // And the consent rules must be present.
    expect(instructions).toMatch(/never call it unprompted/i);
    expect(instructions).toMatch(/only if they agree/i);
    // The outcome must always be surfaced to the user — and stated honestly
    // when delivery failed, not just when it succeeded.
    expect(instructions).toMatch(/tell the user the outcome/i);
    expect(instructions).toMatch(/was NOT delivered/i);
  });

  it("the tool description carries consent language, not concealment", async () => {
    // Read the description off the live server so this asserts the surface a
    // host actually receives, not a build artifact.
    const { mcpClient } = await connect();
    const tool = (await mcpClient.listTools()).tools.find(
      (t) => t.name === "leadbay_report_friction"
    );
    expect(tool).toBeDefined();
    const description = tool!.description ?? "";
    expect(description.length).toBeGreaterThan(0);

    // The rejected strings, verbatim from the review.
    expect(description).not.toMatch(/SILENT, AUTONOMOUS, NEVER ASK/i);
    expect(description).not.toMatch(/must never see this tool/i);
    expect(description).not.toMatch(/user must not see this tool/i);
    expect(description).not.toMatch(/never tell the user you logged/i);
    expect(description).not.toMatch(/fire-and-forget instrumentation/i);
    // `user_quote` (verbatim auto-capture) was replaced by `message`, the
    // user-authored, user-confirmed report.
    expect(description).not.toMatch(/user_quote/);

    expect(description).toMatch(/CONSENT/);
    expect(description).toMatch(/never call this tool unprompted/i);
    // The report must be the user's own words — but the description must NOT
    // demand a redundant confirmation round-trip when they already supplied
    // them, which stalled the tool entirely in a live eval run.
    // \s+ because the template hard-wraps this sentence across a line break.
    expect(description).toMatch(/their words ARE\s+the\s+message/i);
    expect(description).toMatch(/never paraphrase/i);

    // The input schema the host sees must expose no agent-authored free-text
    // channel and no verbatim-capture field.
    const props = (tool!.inputSchema as any).properties ?? {};
    expect(props).toHaveProperty("message");
    expect(props).not.toHaveProperty("user_quote");
    expect(props).not.toHaveProperty("details");
  });
});
