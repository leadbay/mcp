/**
 * `exclude_lead_ids` is capped at 500, and the shortfall top-up is exactly
 * where that bites.
 *
 * The workflow prompt used to say "pass every lead already SEEN" into the
 * top-up's exclusion list. A paid run may examine up to `exploration_cap`'s
 * ceiling — min(20n, 1000) — so on a wide run that instruction builds a list
 * the backend refuses outright, killing the one call that exists to close a
 * gap the user has already paid toward.
 *
 * Two halves to the fix, both pinned here: the tool refuses an over-long list
 * itself, carrying the bounding rule, instead of letting an opaque 400 land
 * after the spend; and the rule it carries is actionable, because
 * `novelty: "org"` already excludes prior DELIVERIES — dropping those is
 * normally enough to fit under the cap.
 */

import { describe, it, expect } from "vitest";
import {
  rejectOversizedExclusions,
  MAX_EXCLUDE_LEAD_IDS,
} from "../../../src/composite/_mcp-job-helpers.js";

/** Distinct, well-formed uuids — canonicalIdSet drops anything else. */
function ids(n: number, seed = 0): string[] {
  return Array.from({ length: n }, (_, i) => {
    const h = (seed * 100000 + i).toString(16).padStart(12, "0");
    return `7b3c1de2-5f40-4a9c-9d21-${h}`;
  });
}

function rejects(value: unknown): boolean {
  try {
    rejectOversizedExclusions(value);
    return false;
  } catch (e) {
    expect((e as { code?: string }).code).toBe("TOO_MANY_EXCLUSIONS");
    return true;
  }
}

describe("rejectOversizedExclusions", () => {
  it("accepts a list exactly at the cap", () => {
    expect(rejects(ids(MAX_EXCLUDE_LEAD_IDS))).toBe(false);
  });

  it("refuses one id over the cap", () => {
    expect(rejects(ids(MAX_EXCLUDE_LEAD_IDS + 1))).toBe(true);
  });

  it("refuses the list a wide exploration_cap would build", () => {
    // count:50 → exploration_cap ceiling min(20n, 1000) = 1000 candidates,
    // so "exclude everything seen" is twice the cap.
    expect(rejects(ids(1000))).toBe(true);
  });

  it("counts what would be SENT, not what was passed", () => {
    // canonicalIdSet dedupes, so a list that merely repeats itself is not a
    // real overflow and must not be refused.
    const repeated = [...ids(MAX_EXCLUDE_LEAD_IDS), ...ids(MAX_EXCLUDE_LEAD_IDS)];
    expect(repeated.length).toBeGreaterThan(MAX_EXCLUDE_LEAD_IDS);
    expect(rejects(repeated)).toBe(false);
  });

  it("drops blanks but still counts non-uuid entries", () => {
    // normalizeUuid only lowercases actual uuids — it passes any other
    // non-empty string through, so a malformed id is still SENT and still
    // consumes cap. Only blanks disappear. Counting it as free would let a
    // list the backend refuses slip past this guard.
    expect(rejects([...ids(MAX_EXCLUDE_LEAD_IDS), "", "   "])).toBe(false);
    expect(rejects([...ids(MAX_EXCLUDE_LEAD_IDS), "not-a-uuid"])).toBe(true);
  });

  it("no-ops on absent exclusions", () => {
    expect(rejects(undefined)).toBe(false);
    expect(rejects(null)).toBe(false);
    expect(rejects([])).toBe(false);
  });

  it("the refusal explains how to get under the cap", () => {
    // An error the agent cannot act on just converts a backend 400 into a
    // local one. It has to name the half of the list that is redundant.
    try {
      rejectOversizedExclusions(ids(1000));
      throw new Error("expected a refusal");
    } catch (e) {
      const hint = (e as { hint?: string }).hint ?? "";
      expect(hint).toMatch(/novelty/i);
      expect(hint).toMatch(/deliver/i);
      expect((e as { message?: string }).message).toContain("1000");
    }
  });
});
