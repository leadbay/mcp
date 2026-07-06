import { describe, it, expect, beforeEach } from "vitest";
import { lb, configure } from "../src/runtime.js";

// Codex P2: when leadbay_enrich_titles returns mode:"needs_confirmation" (host
// can't elicit, or the user declined), lb.enrichment() must NOT reduce the
// response to {mode, preview} — an artifact needs credits_remaining,
// would_launch, message, and next_action to render the spend preview and the
// re-call instructions that drive explicit consent.
//
// New file — the existing domain.test.ts is never modified.

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  configure({});
  delete (globalThis as { cowork?: unknown }).cowork;
});

describe("lb.enrichment — needs_confirmation payload preservation (Codex P2)", () => {
  it("preserves the full needs_confirmation terminal response, not just {mode,preview}", async () => {
    const NEEDS_CONFIRMATION = {
      mode: "needs_confirmation",
      launched: false,
      preview: { enrichable_contacts: 7 },
      would_launch: { titles: ["CEO"], email: true, phone: false },
      enrichable_contacts: 7,
      credits_remaining: 42,
      available_titles: ["CEO", "CFO"],
      message: "Enrichment not launched — awaiting confirmation. …",
      next_action: "Re-call leadbay_enrich_titles with confirm:true …",
    };
    configure({
      call: async (t) =>
        t === "leadbay_enrich_titles" ? NEEDS_CONFIRMATION : {},
    });

    // No confirm passed → this is the awaiting-consent shape. autoLoad:true so
    // the load fires; the point is the terminal payload the artifact receives.
    const e = lb.enrichment({ leadIds: ["L1"], titles: ["CEO"], ask: "ASK", autoLoad: true });
    await tick();

    expect(e.done).toBe(true);
    const data = e.data as Record<string, unknown>;
    // Resource-terminal flags still set…
    expect(data.all_done).toBe(true);
    expect(data.no_job).toBe(true);
    // …AND the full consent payload survives for the artifact to render.
    expect(data.mode).toBe("needs_confirmation");
    expect(data.credits_remaining).toBe(42);
    expect(data.would_launch).toEqual({ titles: ["CEO"], email: true, phone: false });
    expect(data.enrichable_contacts).toBe(7);
    expect(data.message).toContain("awaiting confirmation");
    expect(data.next_action).toContain("confirm:true");
  });

  it("does NOT send confirm on the launch call unless the caller passes it", async () => {
    let sentArgs: Record<string, unknown> | null = null;
    configure({
      call: async (t, a) => {
        if (t === "leadbay_enrich_titles") {
          sentArgs = a;
          return { mode: "needs_confirmation", preview: {} };
        }
        return {};
      },
    });

    const e = lb.enrichment({ leadIds: ["L1"], titles: ["CEO"], ask: "ASK", autoLoad: true });
    await tick();

    expect(sentArgs).not.toBeNull();
    // No blanket confirm:true — page load is not consent (Codex P1 companion).
    expect("confirm" in (sentArgs as object)).toBe(false);
    expect(e.done).toBe(true);
  });
});
