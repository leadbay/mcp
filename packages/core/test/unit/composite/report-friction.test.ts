import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  getHttpRequests,
  httpsMockFactory,
} from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { reportFriction } from "../../../src/composite/report-friction.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

// leadbay_report_friction is consent-gated and user-visible (product#3943).
// The Anthropic MCP-directory review rejected the previous silent design, so
// these tests lock in the properties that make it non-silent: a real
// user-facing confirmation, only user-approved fields on the analytics
// payload, and no agent-authored free-text channel.
describe("leadbay_report_friction", () => {
  it("happy path — reports and returns a visible confirmation", async () => {
    mockHttp([]);
    const result: any = await reportFriction.execute(newClient(), {
      category: "silent_failure",
      message: "Searching Wisconsin returns nothing.",
      tool_called: "leadbay_pull_leads",
      severity: "medium",
    });

    expect(result.reported).toBe(true);
    // The confirmation must be non-empty — the agent shows this back so the
    // user always knows a report was sent. An empty string here would be the
    // old silent behaviour.
    expect(typeof result.message).toBe("string");
    expect(result.message.length).toBeGreaterThan(0);
    expect(result.message).toMatch(/Leadbay team/i);

    expect(result._friction).toEqual({
      category: "silent_failure",
      message: "Searching Wisconsin returns nothing.",
      tool_called: "leadbay_pull_leads",
      severity: "medium",
    });
    expect(result._meta.region).toBe("us");
  });

  it("telemetry-only — never touches the Leadbay backend", async () => {
    mockHttp([]);
    await reportFriction.execute(newClient(), {
      category: "wrong_result",
      message: "I asked for Wisconsin and got Wyoming.",
    });
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("omits optional fields that were not supplied", async () => {
    mockHttp([]);
    const result: any = await reportFriction.execute(newClient(), {
      category: "missing_capability",
      message: "I wish I could export to HubSpot.",
    });
    expect(result._friction).toEqual({
      category: "missing_capability",
      message: "I wish I could export to HubSpot.",
    });
    expect(result._friction).not.toHaveProperty("tool_called");
    expect(result._friction).not.toHaveProperty("severity");
  });

  it("caps the message at 500 chars", async () => {
    mockHttp([]);
    const long = "x".repeat(600);
    const result: any = await reportFriction.execute(newClient(), {
      category: "other",
      message: long,
    });
    expect(result._friction.message).toBe(`${"x".repeat(500)}…`);
  });

  it("carries no agent-authored free-text channel", async () => {
    // `details` was the agent-written field the user never saw or approved.
    // It is gone from the schema; passing it must not leak into the payload.
    mockHttp([]);
    const result: any = await reportFriction.execute(newClient(), {
      category: "other",
      message: "Approved wording only.",
      details: "agent-authored context the user never approved",
    } as any);
    expect(result._friction).not.toHaveProperty("details");
    expect(JSON.stringify(result._friction)).not.toContain("never approved");

    const props = (reportFriction.inputSchema as any).properties;
    expect(props).not.toHaveProperty("details");
    expect(props).not.toHaveProperty("user_quote");
    expect((reportFriction.inputSchema as any).additionalProperties).toBe(false);
    expect((reportFriction.inputSchema as any).required).toEqual([
      "category",
      "message",
    ]);
  });

  it("rejects an invalid category", async () => {
    mockHttp([]);
    const result: any = await reportFriction.execute(newClient(), {
      category: "nonsense",
      message: "something broke",
    } as any);
    expect(result.error).toBe(true);
    expect(result.code).toBe("BAD_INPUT");
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("rejects a missing or blank message", async () => {
    mockHttp([]);
    for (const message of [undefined, "", "   "]) {
      const result: any = await reportFriction.execute(newClient(), {
        category: "other",
        message,
      } as any);
      expect(result.error).toBe(true);
      expect(result.code).toBe("BAD_INPUT");
      expect(result.message).toMatch(/message is required/i);
    }
  });

  it("rejects an invalid severity", async () => {
    mockHttp([]);
    const result: any = await reportFriction.execute(newClient(), {
      category: "other",
      message: "something broke",
      severity: "catastrophic",
    } as any);
    expect(result.error).toBe(true);
    expect(result.code).toBe("BAD_INPUT");
    expect(result.message).toMatch(/severity/i);
  });

  it("stays callable on read-only deployments", async () => {
    // A user must still be able to ask for a problem to be reported when
    // LEADBAY_MCP_WRITE=0, so this tool is not write-gated.
    expect(reportFriction.write).toBe(false);
  });
});
