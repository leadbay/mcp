/**
 * Audit: the MCP-first delivery tools carry a usable routing block.
 *
 * Same contract `routing-block.test.ts` enforces for the tools listed in its
 * TOOLS_WITH_ROUTING set — `## WHEN TO USE` inside the 600-char window every
 * chat host loads even when truncating, trigger phrases, the shared memory
 * pointer, and ≥2 positive AND ≥2 negative examples. Asserted here instead of
 * by appending three names to that established set, so the audit file itself
 * stays unchanged.
 *
 * This matters more for these three than for most tools. Each has a
 * plausible-looking older neighbour (`leadbay_pull_leads`,
 * `leadbay_bulk_qualify_leads`, the other `*_status` pollers), and two of the
 * three SPEND. A truncating host that never sees the routing block routes to
 * the neighbour, which is a wrong answer on the read path and a wrong charge
 * on the write path.
 *
 * Not re-asserted here: `anti_triggers[].route_to` resolution. That check in
 * routing-block.test.ts iterates every registered tool rather than only the
 * listed ones, so it already covers these three.
 */

import { describe, it, expect } from "vitest";
import { mcpFirstDeliveryAllTools, type Tool } from "@leadbay/core";

const ROUTING_HEAD_WINDOW = 600;
const EXAMPLE_WINDOW = 1500;
const MEMORY_POINTER =
  "**Memory:** recall + capture via `leadbay_agent_memory_*` tools.";

const POS_BLOCK_RE =
  /Examples that SHOULD invoke this tool:\n([\s\S]+?)(?:\n\n|$)/;
const NEG_BLOCK_RE =
  /Examples that should NOT invoke this tool[^:]*:\n([\s\S]+?)(?:\n\n|$)/;

const DELIVERY_TOOLS: Tool[] = mcpFirstDeliveryAllTools;

function countBullets(block: RegExpMatchArray | null): number {
  if (!block) return 0;
  return block[1].split("\n").filter((l) => l.trim().startsWith("- ")).length;
}

describe("audit: routing block on the MCP-first delivery tools", () => {
  it("covers all three delivery tools", () => {
    // Guards the fixture: mcpFirstDeliveryAllTools is the ungated registry, so
    // a tool dropped from it would silently shrink everything below.
    expect(DELIVERY_TOOLS.map((t) => t.name).sort()).toEqual([
      "leadbay_find_new_leads",
      "leadbay_lead_job_status",
      "leadbay_qualify_leads",
    ]);
  });

  it("each has WHEN TO USE in the first 600 chars", () => {
    const violations = DELIVERY_TOOLS.filter(
      (t) => !t.description.slice(0, ROUTING_HEAD_WINDOW).includes("## WHEN TO USE"),
    ).map(
      (t) =>
        `${t.name}: '## WHEN TO USE' missing from first ${ROUTING_HEAD_WINDOW} chars (description length ${t.description.length})`,
    );
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("each lists at least one trigger phrase", () => {
    const violations = DELIVERY_TOOLS.filter(
      (t) => !t.description.slice(0, ROUTING_HEAD_WINDOW).match(/Trigger phrases: "/),
    ).map((t) => `${t.name}: WHEN TO USE block has no trigger phrases`);
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("each carries the shared agent-memory pointer in the first 600 chars", () => {
    const violations = DELIVERY_TOOLS.filter(
      (t) => !t.description.slice(0, ROUTING_HEAD_WINDOW).includes(MEMORY_POINTER),
    ).map((t) => `${t.name}: missing memory pointer in first ${ROUTING_HEAD_WINDOW} chars`);
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("each carries ≥2 positive AND ≥2 negative example messages", () => {
    // The negatives are the load-bearing half on these three: every one of
    // them sounds like the neighbour it must not route to.
    const violations: string[] = [];
    for (const t of DELIVERY_TOOLS) {
      const head = t.description.slice(0, EXAMPLE_WINDOW);
      const posCount = countBullets(head.match(POS_BLOCK_RE));
      const negCount = countBullets(head.match(NEG_BLOCK_RE));
      if (posCount < 2) {
        violations.push(`${t.name}: only ${posCount} positive example(s) (need ≥2)`);
      }
      if (negCount < 2) {
        violations.push(`${t.name}: only ${negCount} negative example(s) (need ≥2)`);
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });
});
