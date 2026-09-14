/**
 * Audit: cancellation guidance tells the truth for BOTH job families.
 *
 * Neither family can be cancelled. Once a job is launched the backend runs it
 * to completion — that is the rule `launched-work-not-cancellable.test.ts`
 * pins across the tool descriptions, and this file pins it in the server
 * instructions. A host Cancel stops OUR wait and nothing else.
 *
 * The families still get separate clauses, because the HANDLE differs and
 * handing the agent the wrong one strands the job:
 *
 *   - legacy launchers  → notification_id / importIds
 *   - delivery jobs     → job_id, re-read with leadbay_lead_job_status
 *
 * This file previously asserted the opposite for the legacy half: that a
 * bulk-store entry flipped to 'cancelled' and later polls returned
 * BULK_CANCELLED. That store was deleted in 0.36.0 (product#4005), so the
 * promise became a lie about a record that no longer exists. The delivery
 * half was already written this way and is unchanged.
 */

import { describe, it, expect } from "vitest";
import { buildServerInstructions } from "../../src/server.js";

const DELIVERY = [
  "leadbay_find_new_leads",
  "leadbay_qualify_leads",
  "leadbay_lead_job_status",
];
const LEGACY = ["leadbay_bulk_qualify_leads", "leadbay_enrich_titles"];

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
  it("promises no cancellation transition to EITHER family", () => {
    // The bulk store is gone. Nothing flips to 'cancelled' and no status poll
    // answers BULK_CANCELLED, so neither phrasing may reappear for any tool —
    // following it would tell the agent to stop polling live, paid work.
    for (const exposed of [DELIVERY, LEGACY, [...LEGACY, ...DELIVERY]]) {
      const clause = cancellationClause(exposed);
      expect(clause).not.toMatch(/BULK_CANCELLED/);
      expect(clause).not.toMatch(/transitions to 'cancelled'/);
      expect(clause).not.toMatch(/bulk-store/);
    }
  });

  it("says a cancelled job of either family keeps running backend-side", () => {
    expect(cancellationClause(DELIVERY)).toMatch(/BACKEND-owned|backend-owned/);
    expect(cancellationClause(LEGACY)).toMatch(/keeps running on the backend/);
  });

  it("gives each family the handle that actually picks its job back up", () => {
    const delivery = cancellationClause(DELIVERY);
    expect(delivery).toContain("leadbay_lead_job_status");
    expect(delivery).toContain("job_id");

    const legacy = cancellationClause(LEGACY);
    expect(legacy).toContain("notification_id");
    expect(legacy).toContain("importIds");
  });

  it("keeps the two families in separate clauses when both are exposed", () => {
    const clause = cancellationClause([...LEGACY, ...DELIVERY]);
    // The delivery names must not land inside the legacy sentence: their
    // handle is a job_id, and pointing them at notification_id / importIds
    // strands a job that is still spending.
    const legacyHalf = clause.slice(0, clause.indexOf("importIds"));
    for (const name of DELIVERY) {
      expect(legacyHalf, `${name} named inside the legacy-handle clause`).not.toContain(
        name
      );
    }
    // …and the legacy names must not land inside the delivery sentence.
    const deliveryHalf = clause.slice(clause.indexOf("leadbay_lead_job_status"));
    for (const name of LEGACY) {
      expect(deliveryHalf, `${name} named inside the delivery clause`).not.toContain(
        name
      );
    }
  });

  it("names all three delivery tools in the progress list still", () => {
    // The split must not have dropped them from bullet (1) — being absent
    // there is what made the calls look frozen in the first place.
    const text = buildServerInstructions(new Set([...LEGACY, ...DELIVERY]));
    const progress = text.slice(
      text.indexOf("(1) `notifications/progress`"),
      text.indexOf("(2) `notifications/cancelled`")
    );
    for (const name of DELIVERY) expect(progress).toContain(name);
  });
});
