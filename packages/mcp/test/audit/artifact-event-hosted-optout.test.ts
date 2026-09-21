import { describe, expect, it, vi } from "vitest";
import { httpsMockFactory } from "../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { bindTelemetryIdentity } from "../../src/http-server.js";

/**
 * Hosted-transport opt-out for artifact-runtime telemetry (product#4081).
 *
 * On the hosted, multi-tenant HTTP/SSE server every request gets a telemetry
 * handle from bindTelemetryIdentity(), which wraps each PASSIVE analytics
 * capture in an `isSuppressed` gate and threads the per-request identity.
 * Anything not named there falls through the `...base` spread — ungated and
 * unidentified.
 *
 * captureArtifactEvent was originally missing from that list. The consequence
 * was twofold and silent: a hosted user who ran `leadbay_set_telemetry disable`
 * still emitted artifact outcome events, and those events carried no identity,
 * so they landed on the wrong distinctId. The stdio tests did not catch it
 * because they drive buildServer with a bare initTelemetry handle, which never
 * passes through bindTelemetryIdentity at all.
 *
 * Artifact events are automatic diagnostics the user never asked to send, so
 * they belong on the SUPPRESSED side of the line — unlike report_friction and
 * send_feedback, which are user-initiated deliveries of the user's own words
 * and are deliberately exempt (see friction-suppression-honesty.test.ts).
 */
describe("audit: artifact events honor the hosted telemetry opt-out", () => {
  const identity = { distinctId: "alice@leadbay.test", region: "us" } as any;

  function baseHandle() {
    const calls: Record<string, any[]> = {
      artifact: [],
      toolCall: [],
      friction: [],
      exception: [],
    };
    const base: any = new Proxy(
      {
        captureArtifactEvent: (p: any, id: any) => calls.artifact.push({ p, id }),
        captureToolCall: (p: any, id: any) => calls.toolCall.push({ p, id }),
        captureFrictionReported: (p: any) => {
          calls.friction.push(p);
          return true;
        },
        captureException: (e: any, ctx: any) => calls.exception.push({ e, ctx }),
      },
      { get: (t: any, prop: string) => (prop in t ? t[prop] : () => undefined) }
    );
    return { base, calls };
  }

  const OUTCOMES = ["options_empty", "action_blocked", "result_rejected"] as const;

  it("an opted-out user emits NO artifact outcome events", () => {
    const { base, calls } = baseHandle();
    const bound = bindTelemetryIdentity(base, identity, () => true);
    for (const kind of OUTCOMES) {
      bound.captureArtifactEvent({ kind, surface: "field" } as any);
    }
    expect(calls.artifact).toHaveLength(0);
  });

  it("artifact events are suppressed exactly like the other passive captures", () => {
    const { base, calls } = baseHandle();
    const bound = bindTelemetryIdentity(base, identity, () => true);
    bound.captureArtifactEvent({ kind: "options_empty", surface: "field" } as any);
    bound.captureToolCall({ tool: "leadbay_pull_leads" } as any);
    // Both are passive analytics; neither may escape an opt-out.
    expect(calls.artifact).toHaveLength(0);
    expect(calls.toolCall).toHaveLength(0);
  });

  it("an opted-IN user still emits, and the event carries the request identity", () => {
    const { base, calls } = baseHandle();
    const bound = bindTelemetryIdentity(base, identity, () => false);
    bound.captureArtifactEvent({
      kind: "result_rejected",
      surface: "action",
      tool: "leadbay_add_note",
    } as any);
    expect(calls.artifact).toHaveLength(1);
    expect(calls.artifact[0].p).toMatchObject({
      kind: "result_rejected",
      surface: "action",
      tool: "leadbay_add_note",
    });
    // Identity must ride along, or a multi-tenant event lands on the wrong user.
    expect(calls.artifact[0].id).toBe(identity);
  });

  it("with no suppression predicate at all it still threads identity", () => {
    const { base, calls } = baseHandle();
    const bound = bindTelemetryIdentity(base, identity);
    bound.captureArtifactEvent({ kind: "options_empty", surface: "field" } as any);
    expect(calls.artifact).toHaveLength(1);
    expect(calls.artifact[0].id).toBe(identity);
  });

  it("suppression is evaluated per call, so a mid-session opt-out takes effect", () => {
    const { base, calls } = baseHandle();
    let suppressed = false;
    const bound = bindTelemetryIdentity(base, identity, () => suppressed);
    bound.captureArtifactEvent({ kind: "options_empty", surface: "field" } as any);
    suppressed = true; // user runs leadbay_set_telemetry disable
    bound.captureArtifactEvent({ kind: "action_blocked", surface: "action" } as any);
    expect(calls.artifact).toHaveLength(1);
    expect(calls.artifact[0].p.kind).toBe("options_empty");
  });

  it("the consent-gated friction exemption is NOT extended to artifact events", () => {
    // report_friction survives an opt-out on purpose: the user wrote and
    // approved it. An artifact event is the opposite — automatic, unprompted.
    // This guards against someone "fixing" a dropped artifact event by copying
    // the friction carve-out.
    const { base, calls } = baseHandle();
    const bound = bindTelemetryIdentity(base, identity, () => true);
    bound.captureFrictionReported({ category: "other", message: "mine" } as any);
    bound.captureArtifactEvent({ kind: "options_empty", surface: "field" } as any);
    expect(calls.friction).toHaveLength(1); // user's own words: delivered
    expect(calls.artifact).toHaveLength(0); // passive diagnostics: dropped
  });

  it("artifact EXCEPTIONS ride captureException, which is already gated", () => {
    // The four exception kinds never reach captureArtifactEvent — they go to
    // Sentry via captureException. Confirm that path is suppressed too, so
    // neither half of the split leaks for an opted-out user.
    const { base, calls } = baseHandle();
    const bound = bindTelemetryIdentity(base, identity, () => true);
    bound.captureException(new Error("artifact call_timeout"), {
      tool: "leadbay_add_note",
      source: "artifact",
    } as any);
    expect(calls.exception).toHaveLength(0);
  });
});
