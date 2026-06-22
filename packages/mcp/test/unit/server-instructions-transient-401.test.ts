/**
 * buildServerInstructions — TRANSIENT_401 guidance is always present (product#3761).
 *
 * The "401 hallucination" bug: on the local stdio server, the agent occasionally
 * read a lone AUTH_EXPIRED / 401 (which the client already auto-retried, and which
 * is a transient Leadbay-side blip on a non-expiring token) as a real auth failure
 * and told the user to reconnect / re-authenticate — even though the next call
 * worked. The fix is an always-on server-instruction paragraph that tells the agent
 * to retry silently and never turn a one-off 401 into a re-auth message.
 *
 * This locks that the paragraph is actually concatenated into what the host
 * receives, regardless of which tools are exposed (it must not be gated on a tool).
 */
import { describe, it, expect } from "vitest";
import { buildServerInstructions } from "../../src/server.js";
import { TRANSIENT_401 } from "../../src/server-instructions.generated.js";

describe("buildServerInstructions — transient-401 guidance (product#3761)", () => {
  it("includes the TRANSIENT_401 paragraph on a full exposure set", () => {
    const out = buildServerInstructions(
      new Set([
        "leadbay_pull_leads",
        "leadbay_pull_followups",
        "leadbay_report_outreach",
        "leadbay_report_friction",
      ])
    );
    expect(out).toContain(TRANSIENT_401);
  });

  it("includes it even on a minimal/empty exposure set (not tool-gated)", () => {
    const out = buildServerInstructions(new Set<string>());
    expect(out).toContain(TRANSIENT_401);
  });

  it("the guidance steers the agent away from a re-auth message and toward silent retry", () => {
    const text = TRANSIENT_401.toLowerCase();
    expect(text).toContain("401");
    expect(text).toContain("silently retry");
    // The whole point: do not tell the user to reconnect / re-authenticate on a one-off 401.
    expect(text).toMatch(/do not tell the user to log in again|reconnect|reauthorize/);
  });
});
