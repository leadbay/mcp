/**
 * Audit-compliance #6: every registered tool name follows the
 * `leadbay_<verb>_<noun>` convention.
 *
 * This prevents accidental drift like `leadbay_listSomething` (camelCase
 * leaks from upstream APIs) or `LEADBAY_get_x` (mis-cased prefix). The
 * convention shows up in agent traces and slash-commands; treat it as
 * load-bearing.
 */
import { describe, it, expect } from "vitest";
import {
  compositeReadTools,
  compositeWriteTools,
  granularReadTools,
  granularWriteTools,
} from "@leadbay/core";

const NAME_PATTERN = /^leadbay_[a-z][a-z0-9_]*$/;

describe("audit: tool name convention", () => {
  const allTools = [
    ...compositeReadTools,
    ...compositeWriteTools,
    ...granularReadTools,
    ...granularWriteTools,
  ];

  it("all tool names match the leadbay_<lowercase_with_underscores> pattern", () => {
    const violations = allTools
      .map((t) => t.name)
      .filter((n) => !NAME_PATTERN.test(n));
    expect(violations).toEqual([]);
  });

  it("each tool name resolves to exactly one Tool object (cross-tier sharing OK)", () => {
    // A name can appear in multiple tier arrays (granular tools intentionally
    // surfaced into composite for the file-import prompts) — but the underlying
    // Tool object must be identical. Two different objects with the same name
    // means the registry is double-defined.
    const byName = new Map<string, unknown>();
    const conflicts: string[] = [];
    for (const t of allTools) {
      const seen = byName.get(t.name);
      if (seen && seen !== t) {
        conflicts.push(t.name);
      }
      byName.set(t.name, t);
    }
    expect(conflicts).toEqual([]);
  });
});
