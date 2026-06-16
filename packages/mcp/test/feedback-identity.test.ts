/**
 * Feedback must be ATTRIBUTABLE. captureFeedback awaits the in-flight
 * identify() (bounded) before sending, so name/email from /users/me land on
 * the Sentry envelope even when the user reports something in the first second
 * of a session (e.g. "report a bug" as the opening message). Without the await,
 * `me` is still null and the feedback reaches the team's inbox anonymous — they
 * can't attribute it or reply. This proves the enrichment and the race fix.
 *
 * initTelemetry() short-circuits to NOOP under NODE_ENV=test, so we clear it
 * for the duration of init (same trick as feedback-flush.test.ts).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  setUser: vi.fn(),
  captureException: vi.fn(),
  captureFeedback: vi.fn(),
  withScope: vi.fn((fn: (s: any) => void) =>
    fn({ setTag() {}, setExtra() {}, setUser() {}, setFingerprint() {} })
  ),
  flush: vi.fn(async () => true),
  close: vi.fn(async () => true),
  httpIntegration: vi.fn(() => ({ name: "Http" })),
}));
vi.mock("@sentry/node", () => sentry);
vi.mock("posthog-node", () => ({
  PostHog: class {
    capture() {}
    identify() {}
    groupIdentify() {}
    async shutdown() {}
  },
}));

import { initTelemetry } from "../src/telemetry.js";

const origEnv = process.env.NODE_ENV;
function realHandle() {
  process.env.NODE_ENV = "production";
  process.env.LEADBAY_SENTRY_DSN = "https://abc@o1.ingest.us.sentry.io/2";
  const h = initTelemetry({ version: "0.0.0-test" });
  process.env.NODE_ENV = origEnv;
  return h;
}

// Minimal client stub: only resolveMe() + region are used by identify().
function clientWithMe(me: any, opts?: { delayMs?: number }) {
  return {
    region: "us",
    resolveMe: vi.fn(async () => {
      if (opts?.delayMs) {
        await new Promise((r) => setTimeout(r, opts.delayMs));
      }
      return me;
    }),
  } as any;
}

beforeEach(() => {
  sentry.captureFeedback.mockClear();
  sentry.flush.mockClear();
});
afterEach(() => {
  process.env.NODE_ENV = origEnv;
  delete process.env.LEADBAY_SENTRY_DSN;
});

describe("captureFeedback attaches identity (no anonymous feedback)", () => {
  it("attaches name+email from /users/me once identify has resolved", async () => {
    const h = realHandle();
    await h.identify(
      clientWithMe({
        id: "u1",
        name: "Ada Lovelace",
        email: "ada@example.com",
        organization: { id: "o1", name: "Org" },
      })
    );
    const sent = await h.captureFeedback("scores feel off");
    expect(sent).toBe(true);
    const arg = sentry.captureFeedback.mock.calls[0][0];
    expect(arg.message).toBe("scores feel off");
    expect(arg.name).toBe("Ada Lovelace");
    expect(arg.email).toBe("ada@example.com");
  });

  it("waits for an in-flight identify so first-second feedback is NOT anonymous", async () => {
    const h = realHandle();
    // Fire identify but do NOT await it — simulates the non-blocking server wiring.
    void h.identify(
      clientWithMe(
        {
          id: "u2",
          name: "Grace Hopper",
          email: "grace@example.com",
          organization: { id: "o2", name: "Org" },
        },
        { delayMs: 30 }
      )
    );
    // Call feedback immediately, while identify is still pending.
    const sent = await h.captureFeedback("bug on startup");
    expect(sent).toBe(true);
    const arg = sentry.captureFeedback.mock.calls[0][0];
    // Identity attached because captureFeedback awaited the in-flight promise.
    expect(arg.name).toBe("Grace Hopper");
    expect(arg.email).toBe("grace@example.com");
  });

  it("sends anyway (anonymous) if identity never resolves — feedback is not dropped", async () => {
    const h = realHandle();
    // identify hangs far past the 2s bound; feedback must still go out.
    void h.identify(clientWithMe({ id: "u3" }, { delayMs: 10_000 }));
    const sent = await h.captureFeedback("urgent");
    expect(sent).toBe(true);
    const arg = sentry.captureFeedback.mock.calls[0][0];
    expect(arg.message).toBe("urgent");
    // No name/email — but the report still reached the inbox.
    expect(arg.name).toBeUndefined();
    expect(arg.email).toBeUndefined();
  }, 7000);
});
