/**
 * Where the routing examples live.
 *
 * They used to ship inside the description: three sentences that should call
 * the tool and three that should not, 17,223 characters across the surface,
 * inside the window a host keeps. Claude Code truncates a description at 2,048
 * characters, so that text competed with the rules for the same room.
 *
 * The split now is:
 *   - NEGATIVES stay in the head. Each one sounds like the neighbour it must
 *     not route to, which is the judgement the agent has to make there.
 *   - POSITIVES move to ROUTING_EXAMPLES, a test set rather than shipped text.
 *
 * Measured before the split, `claude -p` against two built servers, 11 runs a
 * side on three sentences: routing held with both halves removed. The
 * negatives were kept because the single misroute observed went to a
 * neighbouring tool, which is what a negative example exists to prevent.
 *
 * New file — does not modify routing-block.test.ts.
 */
import { describe, it, expect } from "vitest";
import { ROUTING_EXAMPLES, compositeReadTools, compositeWriteTools } from "@leadbay/core";

const TOOLS = [...compositeReadTools, ...compositeWriteTools];

describe("routing examples: negatives ship, positives are a test set", () => {
  it("every routed tool keeps both halves in the test set", () => {
    const thin: string[] = [];
    for (const [name, ex] of Object.entries(ROUTING_EXAMPLES)) {
      if (ex.positive.length < 2) thin.push(`${name}: ${ex.positive.length} positive`);
      if (ex.negative.length < 2) thin.push(`${name}: ${ex.negative.length} negative`);
    }
    expect(thin, `A routing example set is what an eval replays; keep two of each.`).toEqual([]);
  });

  it("no positive example sentence is shipped in a description", () => {
    // A positive example is a sentence the agent would have produced anyway.
    // If one reappears in the head, the split has silently regressed.
    const leaked: string[] = [];
    for (const t of TOOLS) {
      const ex = ROUTING_EXAMPLES[t.name];
      if (!ex) continue;
      for (const sentence of ex.positive) {
        if (t.description.includes(sentence)) leaked.push(`${t.name}: "${sentence}"`);
      }
    }
    expect(leaked, "positives belong in ROUTING_EXAMPLES, not in the description").toEqual([]);
  });

  it("the negatives do reach the agent, where the discrimination happens", () => {
    const missing: string[] = [];
    for (const t of TOOLS) {
      const ex = ROUTING_EXAMPLES[t.name];
      if (!ex || ex.negative.length === 0) continue;
      const shipped = ex.negative.filter((s) => t.description.includes(s)).length;
      if (shipped === 0) missing.push(t.name);
    }
    expect(missing, "a routed tool ships no negative example; the head lost its discrimination").toEqual(
      [],
    );
  });

  it("a negative example names a real tool somewhere in the head", () => {
    // The point of a negative is the neighbour it routes to. The anti-trigger
    // line carries that mapping; this catches a head that kept the sentences
    // and lost the targets.
    const orphaned: string[] = [];
    for (const t of TOOLS) {
      const ex = ROUTING_EXAMPLES[t.name];
      if (!ex || ex.negative.length === 0) continue;
      const head = t.description.slice(0, 2500);
      if (!/→ `leadbay_[a-z0-9_]+`/.test(head)) orphaned.push(t.name);
    }
    expect(orphaned, "negatives without an anti-trigger target teach nothing").toEqual([]);
  });
});
