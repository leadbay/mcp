/**
 * Audit: tool descriptions say what the tool does, in neutral language.
 *
 * OpenAI rejected Leadbay v0.34.0 for "tool naming and description quality …
 * descriptions must clearly explain when the tool should be used without
 * including comparative, biased, or preferential language".
 *
 * Two rules come out of the plugin guidelines, under "Descriptions that match
 * behavior" and "Fair play":
 *
 *   1. "Each tool must include a description that explains its purpose
 *      explicitly and accurately." Before this audit, a routed description
 *      opened with `## WHEN TO USE` and a list of trigger phrases — 1,200
 *      characters that never said what the tool does. Promptforge now emits
 *      `## WHAT IT DOES` from `short_description` first.
 *   2. No comparative or promotional wording. The banned list below is the
 *      vocabulary that was actually in the catalogue at rejection time
 *      ("beats inline prose by miles", "the canonical surface", "PREFERRED",
 *      "Prefer when"), plus the words OpenAI names itself.
 */
import { describe, it, expect } from "vitest";
import {
  compositeReadTools,
  compositeWriteTools,
  granularReadTools,
  granularWriteTools,
  type Tool,
} from "@leadbay/core";

const ALL: Tool[] = [
  ...compositeReadTools,
  ...compositeWriteTools,
  ...granularReadTools,
  ...granularWriteTools,
];

describe("audit: description quality (OpenAI plugin guidelines)", () => {
  it("a description that carries routing states its purpose first", () => {
    const offenders: string[] = [];
    for (const t of ALL) {
      if (!t.description.includes("## WHEN TO USE")) continue;
      if (!t.description.startsWith("## WHAT IT DOES")) {
        offenders.push(`${t.name}: opens with "${t.description.slice(0, 40)}…"`);
      }
      const whenAt = t.description.indexOf("## WHEN TO USE");
      const doesAt = t.description.indexOf("## WHAT IT DOES");
      if (doesAt > whenAt) offenders.push(`${t.name}: WHAT IT DOES sits after WHEN TO USE`);
    }
    expect(
      offenders,
      "See packages/promptforge/src/assembler.ts applyDescriptionHeader.",
    ).toEqual([]);
  });

  it("no description uses comparative or promotional wording", () => {
    // Word-boundary matches only, so "best-effort" and a user's own quoted
    // phrasing inside trigger lists are not swept up by accident.
    const BANNED = [
      /\bbeats\b/i,
      /\bby miles\b/i,
      /\bcanonical surface\b/i,
      /\bPREFERRED\b/,
      /^Prefer when:/m,
      /\bworld-class\b/i,
      /\bbetter than\b/i,
      /\boutperforms?\b/i,
      /\bthe best tool\b/i,
      /\bofficial\b/i,
    ];
    const offenders: string[] = [];
    for (const t of ALL) {
      for (const re of BANNED) {
        const m = t.description.match(re);
        if (m) offenders.push(`${t.name}: "${m[0]}"`);
      }
    }
    expect(
      offenders,
      "OpenAI plugin guidelines: descriptions must not favour or disparage other tools or services.",
    ).toEqual([]);
  });

  it("every tool name is lower_snake_case under the leadbay_ namespace", () => {
    const offenders = ALL.map((t) => t.name).filter((n) => !/^leadbay_[a-z0-9_]+$/.test(n));
    expect(offenders).toEqual([]);
  });

  it("tool names are unique across every surface", () => {
    const seen = new Map<string, number>();
    for (const t of ALL) seen.set(t.name, (seen.get(t.name) ?? 0) + 1);
    // A tool may legitimately appear in two catalogue arrays (the server dedups
    // by name); what must never happen is two DIFFERENT tools sharing a name.
    const collisions: string[] = [];
    for (const [name, count] of seen) {
      if (count === 1) continue;
      const distinct = new Set(ALL.filter((t) => t.name === name).map((t) => t.description));
      if (distinct.size > 1) collisions.push(name);
    }
    expect(collisions, "two different tools share a name").toEqual([]);
  });
});
