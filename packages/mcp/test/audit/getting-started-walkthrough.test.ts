/**
 * Audit: the getting-started walkthrough (issue leadbay/product#3952) ships as
 * TWO surfaces — the `leadbay_getting_started` MCP prompt and the
 * `leadbay_getting_started` composite tool's step manifest. They are two
 * renderings of ONE sequence, so they can silently diverge: someone edits a
 * gate label in the template and the tool keeps returning the old one.
 *
 * This audit pins the pieces that must agree, plus the two product decisions
 * that a later well-meaning edit would erode: exactly one option per gate, and
 * gate 2 never spending the new user's quota.
 */

import { describe, it, expect } from "vitest";
import { GETTING_STARTED_MANIFEST } from "@leadbay/core";
import { listPrompts, getPrompt } from "../../src/prompts.js";
import { leadbay_getting_started, PROMPT_META } from "../../src/prompts.generated.js";

const BODY = leadbay_getting_started;

describe("audit: getting-started walkthrough", () => {
  it("the prompt is registered in the MCP catalog", () => {
    // Two-place registration: the .md.tmpl AND a CATALOG entry in prompts.ts.
    // leadbay_extend_my_lens / leadbay_followup_check_in each have a generated
    // body but NO catalog entry, so they never appear in prompts/list. This
    // asserts the new prompt didn't repeat that.
    expect(listPrompts().map((p) => p.name)).toContain("leadbay_getting_started");
  });

  it("prompts/get returns a non-empty user message and takes no arguments", () => {
    const result = getPrompt("leadbay_getting_started", {});
    expect(result.messages.length).toBeGreaterThanOrEqual(1);
    expect(result.messages[0].role).toBe("user");
    const text = result.messages[0].content.type === "text" ? result.messages[0].content.text : "";
    expect(text.length).toBeGreaterThan(500);
    // A brand-new user does not parameterize their own onboarding.
    const entry = listPrompts().find((p) => p.name === "leadbay_getting_started");
    expect(entry?.arguments ?? []).toEqual([]);
    // No unsubstituted placeholders leaked into the shipped body.
    expect(text).not.toMatch(/\{\{arg:/);
  });

  it("declares ≥3 failure modes and names the spend gate", () => {
    const modes = PROMPT_META.leadbay_getting_started.failure_modes ?? [];
    // assembler.ts enforces ≥3 for prompts that call mutating tools
    // (leadbay_enrich_titles matches its mutatingPattern).
    expect(modes.length).toBeGreaterThanOrEqual(3);
    const joined = modes.join("\n");
    expect(joined).toMatch(/PAID reveal/);
    expect(joined).toMatch(/ONE option/);
  });

  it("the prompt's gate labels match the tool manifest exactly", () => {
    // The drift-catcher. Every manifest gate_label must appear verbatim in the
    // prompt body, so the two surfaces can't describe different tours.
    for (const step of GETTING_STARTED_MANIFEST.steps) {
      expect(BODY, `gate ${step.n} label missing from prompt body`).toContain(step.gate_label);
    }
  });

  it("the prompt body carries the one-option rule", () => {
    expect(BODY).toMatch(/\*\*exactly ONE option\*\*/);
    expect(BODY).toMatch(/Not one plus "Skip"/);
    // The escape hatch is typing, not a "Skip" button.
    expect(BODY).toMatch(/typing/i);
  });

  it("the prompt body forbids every paid-reveal argument", () => {
    // Mirrors the manifest's forbidden_args. If the template stops naming one,
    // the agent loses the only instruction preventing a paid launch.
    for (const arg of GETTING_STARTED_MANIFEST.steps[1].forbidden_args ?? []) {
      expect(BODY, `prompt body must forbid \`${arg}\``).toMatch(new RegExp(arg));
    }
    expect(BODY).toMatch(/SPENDS NOTHING/);
  });

  it("the prompt body handles the warming lens instead of reporting empty", () => {
    expect(BODY).toMatch(/computing_wishlist/);
    expect(BODY).toMatch(/computing_scores/);
    expect(BODY).toMatch(/NEVER say "no leads found\."/);
  });

  it("the prompt defers scheduling to the host and claims nothing", () => {
    // Leadbay has no scheduling API; the tour must not pretend otherwise.
    expect(BODY).toMatch(/no scheduling API/);
    expect(BODY).toMatch(/never claim a scheduled task was created/i);
    // The gate text must carry the literal recurring language the host's
    // scheduled-task flow gates on.
    expect(BODY).toMatch(/every morning/);
  });

  it("does NOT re-implement the host's frequency/time sub-questions", () => {
    // Two competing scheduling flows in one conversation is a defect. The tour
    // hands off; it must not ask these itself.
    expect(BODY).not.toMatch(/Every weekday/);
    expect(BODY).not.toMatch(/Morning \(8am\)/);
    expect(BODY).not.toMatch(/Which day\?/);
  });

  it("routes orientation-prose asks to the overview prompt instead", () => {
    expect(BODY).toMatch(/leadbay_prospecting_overview/);
  });
});
