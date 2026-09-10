/**
 * Audit: the MCP-first delivery routing fixtures name real tools.
 *
 * The live classifier eval that consumes routing fixtures needs an Anthropic
 * key and is not part of `pnpm -r test`, so a fixture referencing a tool that
 * was renamed — or never existed — sits green forever. `ROUTING_FIXTURES` has
 * had no runner at all since #71 (`bbf5108` removed the classifier eval and
 * left the fixture file orphaned), which is exactly how that rot happens.
 *
 * This audit is the deterministic half: it cannot tell you whether an intent
 * routes correctly, but it can prove every tool the fixtures name is real and
 * that no fixture contradicts itself. That keeps the fixtures honest between
 * eval runs instead of decaying unnoticed.
 */

import { describe, it, expect } from "vitest";
import {
  compositeReadTools,
  compositeWriteTools,
  granularReadTools,
  granularWriteTools,
  mcpFirstDeliveryAllTools,
  type Tool,
} from "@leadbay/core";
import { LEAD_DELIVERY_ROUTING_FIXTURES } from "../eval/tool-descriptions/lead-delivery-routing-fixtures.js";

const ALL_TOOLS: Tool[] = [
  ...compositeReadTools,
  ...compositeWriteTools,
  ...granularReadTools,
  ...granularWriteTools,
  ...mcpFirstDeliveryAllTools,
];
const REGISTERED = new Set(ALL_TOOLS.map((t) => t.name));

describe("audit: lead-delivery routing fixtures", () => {
  it("covers all three delivery tools", () => {
    // Guards the fixture set itself: silently losing a tool's cases would
    // leave this audit passing over a narrower set than it claims to cover.
    const covered = new Set(
      LEAD_DELIVERY_ROUTING_FIXTURES.map((f) => f.expected_tool),
    );
    expect([...covered].sort()).toEqual([
      "leadbay_find_new_leads",
      "leadbay_lead_job_status",
      "leadbay_qualify_leads",
    ]);
  });

  it("every expected_tool is a registered tool", () => {
    const unknown = LEAD_DELIVERY_ROUTING_FIXTURES.filter(
      (f) => !REGISTERED.has(f.expected_tool),
    ).map((f) => `${f.expected_tool} (intent: "${f.intent}")`);
    expect(unknown, unknown.join("\n")).toEqual([]);
  });

  it("every forbidden_tools entry is a registered tool", () => {
    // A typo here is worse than useless: the fixture would "pass" its
    // false-positive check against a tool that cannot be routed to anyway.
    const unknown: string[] = [];
    for (const f of LEAD_DELIVERY_ROUTING_FIXTURES) {
      for (const name of f.forbidden_tools ?? []) {
        if (!REGISTERED.has(name)) {
          unknown.push(`${name} (intent: "${f.intent}")`);
        }
      }
    }
    expect(unknown, unknown.join("\n")).toEqual([]);
  });

  it("no fixture forbids the tool it expects", () => {
    const contradictory = LEAD_DELIVERY_ROUTING_FIXTURES.filter((f) =>
      (f.forbidden_tools ?? []).includes(f.expected_tool),
    ).map((f) => f.intent);
    expect(contradictory, contradictory.join("\n")).toEqual([]);
  });

  it("every fixture carries forbidden_tools", () => {
    // On the delivery tools the neighbour route is the PAID mistake
    // (leadbay_pull_leads instead of a net-new search, bulk_qualify instead of
    // the supplied-list path), so the false-positive signal is the point of
    // these fixtures rather than an optional extra.
    const bare = LEAD_DELIVERY_ROUTING_FIXTURES.filter(
      (f) => !f.forbidden_tools?.length,
    ).map((f) => f.intent);
    expect(bare, bare.join("\n")).toEqual([]);
  });
});
