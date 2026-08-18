/**
 * Audit: cancellation guidance tells the truth for BOTH job families.
 *
 * The legacy bulk tools own a bulk-store entry that flips to 'cancelled', so a
 * later status poll returns BULK_CANCELLED and the agent knows to stop. The
 * MCP-first delivery jobs own no such record: cancelling stops OUR wait while
 * the BACKEND job keeps running.
 *
 * Adding the delivery tools to the shared long-runner list made the
 * cancellation sentence promise them a transition that never happens — and
 * told the agent to stop polling a job that was still live and still spending.
 * The two families now get separate clauses.
 */

import { describe, it, expect } from "vitest";
import { buildServerInstructions } from "../../src/server.js";

const DELIVERY = [
  "leadbay_find_new_leads",
  "leadbay_qualify_leads",
  "leadbay_lead_job_status",
];
const BULK = ["leadbay_bulk_qualify_leads", "leadbay_enrich_titles"];

/** The cancellation bullet, isolated from the rest of the instructions.
 *  Bounded by the paragraph break — bullet (3) is itself conditional on the
 *  elicitation tools being exposed, so anchoring on it leaked the whole tail
 *  of the instructions into the clause. */
function cancellationClause(exposed: string[]): string {
  const text = buildServerInstructions(new Set(exposed));
  const start = text.indexOf("(2) `notifications/cancelled`");
  expect(start, "no cancellation bullet in instructions").toBeGreaterThan(-1);
  const break_ = text.indexOf("\n\n", start);
  const next = text.indexOf("(3) `elicitation/create`", start);
  const ends = [break_, next].filter((i) => i > -1);
  return text.slice(start, ends.length ? Math.min(...ends) : undefined);
}

describe("audit: cancellation guidance per job family", () => {
  it("never promises BULK_CANCELLED for a delivery job", () => {
    // The word may appear — the honest text says there is NO BULK_CANCELLED.
    // What must never appear is the PROMISE: a bulk-store transition, or a
    // status poll returning that code.
    const clause = cancellationClause(DELIVERY);
    expect(clause).not.toMatch(/return `BULK_CANCELLED`/);
    expect(clause).not.toMatch(/transitions to 'cancelled'/);
    expect(clause).toMatch(/no `BULK_CANCELLED`/);
  });

  it("says a cancelled delivery job keeps running backend-side", () => {
    const clause = cancellationClause(DELIVERY);
    expect(clause).toMatch(/BACKEND-owned|backend-owned/);
    expect(clause).toContain("leadbay_lead_job_status");
  });

  it("still promises BULK_CANCELLED for the bulk tools", () => {
    const clause = cancellationClause(BULK);
    expect(clause).toContain("BULK_CANCELLED");
  });

  it("keeps the two families in separate clauses when both are exposed", () => {
    const clause = cancellationClause([...BULK, ...DELIVERY]);
    // BULK_CANCELLED must be claimed, but never about a delivery tool: the
    // delivery names must not appear before the bulk-store promise.
    expect(clause).toContain("BULK_CANCELLED");
    const bulkSentenceEnd = clause.indexOf("BULK_CANCELLED");
    const bulkHalf = clause.slice(0, bulkSentenceEnd);
    for (const name of DELIVERY) {
      expect(bulkHalf, `${name} named inside the bulk-store promise`).not.toContain(
        name
      );
    }
  });

  it("names all three delivery tools in the progress list still", () => {
    // The split must not have dropped them from bullet (1) — being absent
    // there is what made the calls look frozen in the first place.
    const text = buildServerInstructions(new Set([...BULK, ...DELIVERY]));
    const progress = text.slice(
      text.indexOf("(1) `notifications/progress`"),
      text.indexOf("(2) `notifications/cancelled`")
    );
    for (const name of DELIVERY) expect(progress).toContain(name);
  });
});
