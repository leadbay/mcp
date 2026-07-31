import { describe, expect, it, vi } from "vitest";
import { httpsMockFactory } from "../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { bindTelemetryIdentity } from "../../src/http-server.js";

/**
 * Hosted-transport honesty for leadbay_report_friction (product#3943, Codex P2).
 *
 * On the hosted HTTP/SSE server every request gets a telemetry handle produced
 * by bindTelemetryIdentity(), which is a NEW object — not the literal
 * NOOP_TELEMETRY. For a user who opted out, its `isSuppressed` predicate drops
 * analytics events silently.
 *
 * That combination used to make the tool lie: the identity check in server.ts
 * (`telemetry === NOOP_TELEMETRY`) never matched the bound wrapper, so the tool
 * returned `reported: true` and the agent told the user "Shared with the Leadbay
 * team" while the event was discarded.
 *
 * The fix treats a consent-gated problem report the same way captureFeedback is
 * already treated: it is an explicit user-initiated delivery of a message the
 * user wrote and approved, NOT passive analytics, so the analytics opt-out must
 * not silently swallow it. This audit locks that in.
 */
describe("audit: friction reports survive the hosted analytics opt-out", () => {
  const identity = { accountId: "acct-1", orgId: "org-1", region: "us" } as any;

  function baseHandle() {
    const calls: Record<string, any[]> = {
      friction: [],
      toolCall: [],
      feedback: [],
    };
    const base: any = new Proxy(
      {
        captureFrictionReported: (p: any) => calls.friction.push(p),
        captureToolCall: (p: any) => calls.toolCall.push(p),
        captureFeedback: async (m: any) => {
          calls.feedback.push(m);
          return true;
        },
      },
      {
        get: (t: any, prop: string) =>
          prop in t ? t[prop] : () => undefined,
      }
    );
    return { base, calls };
  }

  it("delivers the friction report even when analytics are suppressed", () => {
    const { base, calls } = baseHandle();
    const bound = bindTelemetryIdentity(base, identity, () => true);

    bound.captureFrictionReported({
      category: "silent_failure",
      message: "Searching Wisconsin returns nothing.",
    } as any);

    // The user approved this exact message and is shown a confirmation — it must
    // actually go out, otherwise the confirmation is a lie.
    expect(calls.friction).toHaveLength(1);
    expect(calls.friction[0].message).toBe("Searching Wisconsin returns nothing.");
  });

  it("still suppresses passive analytics for the same opted-out user", () => {
    // Guard against over-correcting: the opt-out must keep working for the
    // events it is actually meant to cover.
    const { base, calls } = baseHandle();
    const bound = bindTelemetryIdentity(base, identity, () => true);

    bound.captureToolCall({ tool: "leadbay_pull_leads", ok: true } as any);
    expect(calls.toolCall).toHaveLength(0);
  });

  it("delivers friction reports normally when not suppressed", () => {
    const { base, calls } = baseHandle();
    const bound = bindTelemetryIdentity(base, identity, () => false);

    bound.captureFrictionReported({
      category: "wrong_result",
      message: "Wrong region.",
    } as any);
    expect(calls.friction).toHaveLength(1);
  });
});
