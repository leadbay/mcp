/**
 * Unit tests for buildPullLeadsNextSteps — the deterministic NEXT STEPS the
 * server hands the model to render into the host choice widget.
 *
 * Locks the contract the rest of PR #70 depends on:
 *  - artifact offer ("Build an interactive lead triage board") is ALWAYS options[0]
 *    on a non-empty batch (this is the gate that kept getting dropped in prose),
 *  - returns null on an empty batch so no empty widget fires,
 *  - the pager option only appears when another page actually exists,
 *  - never exceeds the host widget's 4-option cap.
 */

import { describe, it, expect } from "vitest";
import { buildPullLeadsNextSteps } from "../../../src/composite/pull-leads.js";

describe("buildPullLeadsNextSteps", () => {
  it("non-empty batch — artifact offer is options[0]", () => {
    const ns = buildPullLeadsNextSteps({ leadCount: 12, hasMore: false, nextPage: null });
    expect(ns).not.toBeNull();
    expect(ns!.options[0].kind).toBe("build_artifact");
    expect(ns!.options[0].label).toBe("Triage board");
    expect(ns!.options[0].description).toMatch(/triage board/i);
    expect(ns!.question).toBe("What do you want to do next?");
  });

  it("every option has a short label (≤5 words) for the AskUserQuestion cap", () => {
    const ns = buildPullLeadsNextSteps({ leadCount: 20, hasMore: true, nextPage: 1 });
    for (const opt of ns!.options) {
      expect(opt.label.trim().split(/\s+/).length).toBeLessThanOrEqual(5);
      expect(opt.description.length).toBeGreaterThan(opt.label.length);
    }
  });

  it("empty batch — returns null (no empty widget)", () => {
    expect(buildPullLeadsNextSteps({ leadCount: 0, hasMore: false, nextPage: null })).toBeNull();
    expect(buildPullLeadsNextSteps({ leadCount: -1, hasMore: true, nextPage: 1 })).toBeNull();
  });

  it("pager option only when another page exists", () => {
    const withMore = buildPullLeadsNextSteps({ leadCount: 20, hasMore: true, nextPage: 1 });
    const pager = withMore!.options.find((o) => o.kind === "pull_next_page");
    expect(pager).toBeDefined();
    expect(pager!.label).toBe("Next page");
    expect(pager!.description).toBe("Pull page 2 of this lens.");

    const noMore = buildPullLeadsNextSteps({ leadCount: 20, hasMore: false, nextPage: null });
    expect(noMore!.options.some((o) => o.kind === "pull_next_page")).toBe(false);
  });

  it("hasMore true but nextPage null — no pager (guards the null)", () => {
    const ns = buildPullLeadsNextSteps({ leadCount: 5, hasMore: true, nextPage: null });
    expect(ns!.options.some((o) => o.kind === "pull_next_page")).toBe(false);
  });

  it("never exceeds the widget's 4-option cap, artifact still first", () => {
    const ns = buildPullLeadsNextSteps({ leadCount: 50, hasMore: true, nextPage: 3 });
    expect(ns!.options.length).toBeLessThanOrEqual(4);
    expect(ns!.options[0].kind).toBe("build_artifact");
  });
});
