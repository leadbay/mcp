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

// The MCP server wires a `reportFriction` transport into ToolContext. A context
// WITHOUT one models a deployment where delivery is impossible (telemetry off,
// no keys, tests) — the tool must then report honestly instead of confirming.
const deliveredReports: any[] = [];
const ctxWithTransport = () =>
  ({
    reportFriction: (report: any) => {
      deliveredReports.push(report);
      return true;
    },
  }) as any;
const ctxTransportDown = () => ({ reportFriction: () => false }) as any;

beforeEach(() => {
  resetHttpMock();
  deliveredReports.length = 0;
});

// leadbay_report_friction is consent-gated and user-visible (product#3943).
// The Anthropic MCP-directory review rejected the previous silent design, so
// these tests lock in the properties that make it non-silent: a real
// user-facing confirmation, only user-approved fields on the analytics
// payload, and no agent-authored free-text channel.
describe("leadbay_report_friction", () => {
  it("happy path — reports and returns a visible confirmation", async () => {
    mockHttp([]);
    const result: any = await reportFriction.execute(
      newClient(),
      {
        category: "silent_failure",
        message: "Searching Wisconsin returns nothing.",
        tool_called: "leadbay_pull_leads",
        severity: "medium",
      },
      ctxWithTransport()
    );

    expect(result.reported).toBe(true);
    // The transport received exactly the approved fields.
    expect(deliveredReports).toHaveLength(1);
    expect(deliveredReports[0]).toEqual({
      category: "silent_failure",
      message: "Searching Wisconsin returns nothing.",
      tool_called: "leadbay_pull_leads",
      severity: "medium",
    });
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
    await reportFriction.execute(
      newClient(),
      {
        category: "wrong_result",
        message: "I asked for Wisconsin and got Wyoming.",
      },
      ctxWithTransport()
    );
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("omits optional fields that were not supplied", async () => {
    mockHttp([]);
    const result: any = await reportFriction.execute(
      newClient(),
      {
        category: "missing_capability",
        message: "I wish I could export to HubSpot.",
      },
      ctxWithTransport()
    );
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
    const result: any = await reportFriction.execute(
      newClient(),
      {
        category: "other",
        message: long,
      },
      ctxWithTransport()
    );
    expect(result._friction.message).toBe(`${"x".repeat(500)}…`);
  });

  it("carries no agent-authored free-text channel", async () => {
    // `details` was the agent-written field the user never saw or approved.
    // It is gone from the schema; passing it must not leak into the payload.
    mockHttp([]);
    const result: any = await reportFriction.execute(
      newClient(),
      {
        category: "other",
        message: "Approved wording only.",
        details: "agent-authored context the user never approved",
      } as any,
      ctxWithTransport()
    );
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

  it("drops a tool_called that is not a bare leadbay_* tool name", async () => {
    // Codex P1: the MCP SDK does not validate inputSchema before dispatch, so
    // an unconstrained tool_called would be a second agent-authored free-text
    // channel — the thing deleting `details` was meant to close.
    mockHttp([]);
    const junk = [
      "leadbay_pull_leads — and the user's card number is 4111 1111 1111 1111",
      "the pull leads tool, which returned nothing for Wisconsin",
      "LEADBAY_PULL_LEADS",
      "pull_leads",
      "leadbay_pull_leads; DROP TABLE leads",
      "",
      "   ",
      // Shape-valid but NOT a registered tool: a lower-case leadbay_* string is
      // a viable smuggling channel for secrets/PII if only the pattern is
      // checked, so the allowlist must reject it too.
      "leadbay_card_4111111111111111",
      "leadbay_user_said_his_password_is_hunter2",
      "leadbay_not_a_real_tool",
    ];
    for (const tool_called of junk) {
      const result: any = await reportFriction.execute(
        newClient(),
        {
          category: "silent_failure",
          message: "Nothing came back.",
          tool_called,
        } as any,
        ctxWithTransport()
      );
      expect(result.reported).toBe(true);
      expect(result._friction).not.toHaveProperty("tool_called");
      expect(JSON.stringify(result._friction)).not.toContain("4111");
      expect(JSON.stringify(result._friction)).not.toContain("DROP TABLE");
    }
  });

  it("keeps a well-formed tool_called", async () => {
    mockHttp([]);
    const result: any = await reportFriction.execute(
      newClient(),
      {
        category: "silent_failure",
        message: "Nothing came back.",
        tool_called: "leadbay_pull_leads",
      },
      ctxWithTransport()
    );
    expect(result._friction.tool_called).toBe("leadbay_pull_leads");
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

  it("does NOT claim success when no transport is wired", async () => {
    // Codex P2: the report is user-visible now, so a `reported: true` for a
    // report that never left the machine is a false confirmation to the user.
    mockHttp([]);
    const result: any = await reportFriction.execute(newClient(), {
      category: "silent_failure",
      message: "Searching Wisconsin returns nothing.",
    });
    expect(result.reported).toBe(false);
    expect(result.message).toMatch(/could NOT be sent/i);
    expect(result.message).toMatch(/not delivered/i);
    expect(result.message).not.toMatch(/shared with the leadbay team/i);
  });

  it("does NOT claim success when the transport reports failure", async () => {
    // NOOP telemetry (opted out / no keys) returns false from the transport.
    mockHttp([]);
    const result: any = await reportFriction.execute(
      newClient(),
      {
        category: "dissatisfaction",
        message: "The scores feel wrong.",
      },
      ctxTransportDown()
    );
    expect(result.reported).toBe(false);
    expect(result.message).toMatch(/could NOT be sent/i);
    // The payload is still echoed so the agent can show what would have gone.
    expect(result._friction.message).toBe("The scores feel wrong.");
  });

  it("stays callable on read-only deployments", async () => {
    // A user must still be able to ask for a problem to be reported when
    // LEADBAY_MCP_WRITE=0, so this tool is not write-gated.
    expect(reportFriction.write).toBe(false);
  });
});
