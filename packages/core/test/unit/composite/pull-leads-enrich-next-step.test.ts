/**
 * Unit tests for the "Enrich top leads" NEXT STEPS option (issue #3875).
 *
 * After a pull_leads, the deterministic next-steps builder now surfaces an
 * enrichment offer as options[1] — the natural move from discovery toward
 * outreach (reveal decision-maker email/phone on the top leads). This locks:
 *  - a non-empty batch carries an `enrich_top_leads` option,
 *  - it sits at position 2 (right after the always-first artifact offer),
 *  - the option wording promises a no-spend preview (consent gate — it must NOT
 *    read as a silent paid launch),
 *  - the artifact offer is still options[0] and the set still respects the
 *    2–4 host-widget cap,
 *  - the empty-batch / empty-but-computing branches never carry the enrich
 *    option (nothing to enrich yet).
 *
 * NEW FILE — does not touch pull-leads-next-steps.test.ts or
 * pull-leads-computing-next-steps.test.ts.
 */

import { describe, it, expect } from "vitest";
import { buildPullLeadsNextSteps } from "../../../src/composite/pull-leads.js";

describe("buildPullLeadsNextSteps — Enrich top leads (#3875)", () => {
  it("non-empty batch — carries an enrich_top_leads option at position 2", () => {
    const ns = buildPullLeadsNextSteps({ leadCount: 12, hasMore: false, nextPage: null });
    expect(ns).not.toBeNull();
    // Artifact offer is still first; enrich is inserted right after it.
    expect(ns!.options[0].kind).toBe("build_artifact");
    expect(ns!.options[1].kind).toBe("enrich_top_leads");
    expect(ns!.options[1].label).toBe("Enrich top leads");
  });

  it("enrich label is ≤5 words; description promises a no-spend preview", () => {
    const ns = buildPullLeadsNextSteps({ leadCount: 8, hasMore: false, nextPage: null });
    const enrich = ns!.options.find((o) => o.kind === "enrich_top_leads");
    expect(enrich).toBeDefined();
    expect(enrich!.label.trim().split(/\s+/).length).toBeLessThanOrEqual(5);
    // Consent gate: the offer must read as preview-first, not a silent launch.
    expect(enrich!.description).toMatch(/preview/i);
    expect(enrich!.description).toMatch(/no quota spent|confirm/i);
    // It's the email/phone reveal on the top leads (not "fill in the title field").
    expect(enrich!.description).toMatch(/email|phone/i);
  });

  it("artifact-first + ≤4 cap hold even when a pager also contends", () => {
    const ns = buildPullLeadsNextSteps({ leadCount: 50, hasMore: true, nextPage: 3 });
    expect(ns!.options.length).toBeLessThanOrEqual(4);
    expect(ns!.options[0].kind).toBe("build_artifact");
    expect(ns!.options[1].kind).toBe("enrich_top_leads");
    // With a pager contending, the tail (refine_audience) is trimmed by the cap.
    expect(ns!.options.some((o) => o.kind === "pull_next_page")).toBe(true);
    expect(ns!.options.some((o) => o.kind === "refine_audience")).toBe(false);
  });

  it("last page (no pager) — enrich + deepen + refine all fit under the cap", () => {
    const ns = buildPullLeadsNextSteps({ leadCount: 20, hasMore: false, nextPage: null });
    const kinds = ns!.options.map((o) => o.kind);
    expect(kinds).toEqual([
      "build_artifact",
      "enrich_top_leads",
      "qualify_deeper",
      "refine_audience",
    ]);
  });

  it("empty batch — no enrich option (null, nothing to enrich)", () => {
    expect(
      buildPullLeadsNextSteps({ leadCount: 0, hasMore: false, nextPage: null })
    ).toBeNull();
  });

  it("empty-but-computing batch — no enrich option (leads not materialized yet)", () => {
    const ns = buildPullLeadsNextSteps({
      leadCount: 0,
      hasMore: false,
      nextPage: null,
      computingWishlist: true,
    });
    expect(ns).not.toBeNull();
    expect(ns!.options.some((o) => o.kind === "enrich_top_leads")).toBe(false);
  });
});
