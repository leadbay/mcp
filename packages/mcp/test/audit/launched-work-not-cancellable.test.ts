/**
 * Leadbay has no cancel. Once an enrichment, qualification or import launch
 * returns, the backend runs it to completion and the user's quota is already
 * committed — there is no cancel, stop or abort route for any of the three
 * (`LeadsRoutes.kt`, `ImportsRoutes.kt`, and the `/1.6` specs).
 *
 * The MCP used to tell the agent the opposite: a host cancellation flipped a
 * local record to `cancelled`, and the status tools answered "no further work
 * is in flight … relaunch". Following that spends the user's quota a second
 * time on rows Leadbay is still processing.
 *
 * This audit keeps the true statement on the surface the agent actually reads,
 * and keeps the false one from coming back.
 */

import { describe, it, expect } from "vitest";
import {
  compositeReadTools,
  compositeWriteTools,
  granularReadTools,
  granularWriteTools,
  type Tool,
} from "@leadbay/core";
import * as prompts from "../../src/prompts.generated.js";

// Every tool that launches background work, and every tool used to poll it.
const BULK_TOOLS = [
  "leadbay_enrich_titles",
  "leadbay_bulk_qualify_leads",
  "leadbay_import_leads",
  "leadbay_import_and_qualify",
  "leadbay_bulk_enrich_status",
  "leadbay_qualify_status",
  "leadbay_import_status",
] as const;

const ALL_TOOLS: Tool[] = [
  ...compositeReadTools,
  ...compositeWriteTools,
  ...granularReadTools,
  ...granularWriteTools,
];

const byName = new Map(ALL_TOOLS.map((t) => [t.name, t.description]));

const PROMPT_TEXTS: Array<[string, string]> = Object.entries(prompts).filter(
  (e): e is [string, string] => typeof e[1] === "string"
);

describe("a launched job cannot be stopped — the agent is told so", () => {
  it.each(BULK_TOOLS)("%s states that Leadbay has no cancel", (tool) => {
    const text = byName.get(tool);
    expect(text, `${tool} is not a registered tool`).toBeTypeOf("string");
    expect(text).toContain("Leadbay has no cancel");
  });

  it.each(BULK_TOOLS)("%s says a handle must be polled, not relaunched", (tool) => {
    expect(byName.get(tool)).toContain("do not launch again");
  });

  // The rule branches, and each branch is load-bearing: an absolute "never
  // relaunch" strands a call that timed out before it returned a handle, and
  // an unconditional "quota is committed" is wrong for a discovery, preview or
  // dry-run result that launched nothing.
  it.each(BULK_TOOLS)("%s scopes the rule to a launched result", (tool) => {
    expect(byName.get(tool)).toContain("dry_run` result\nlaunched nothing");
  });

  it.each(BULK_TOOLS)("%s tells a handle-less caller to re-call, not to give up", (tool) => {
    expect(byName.get(tool)).toContain("hands back the job already launched");
  });

  it("every prompt carrying the long-running rules carries this one too", () => {
    const carriers = PROMPT_TEXTS.filter(([, body]) =>
      body.includes("Resilience rules for Leadbay long-running tools")
    );
    expect(carriers.length).toBeGreaterThan(0);
    for (const [name, body] of carriers) {
      expect(body, `prompt ${name}`).toContain("Leadbay has no cancel");
    }
  });
});

describe("the old, false model is not reachable from any generated surface", () => {
  // `cancelled` as a JOB state, plus the relaunch advice that rode with it.
  const BANNED = [
    "BULK_CANCELLED",
    "the cancelled record won't block a fresh launch",
    "no further work is in flight",
    "no further qualifications are in flight",
  ];

  const surfaces: Array<[string, string]> = [
    ...ALL_TOOLS.map((t) => [`tool ${t.name}`, t.description] as [string, string]),
    ...PROMPT_TEXTS.map(([k, v]) => [`prompt ${k}`, v] as [string, string]),
  ];

  it.each(BANNED)("no generated surface says %j", (phrase) => {
    const offenders = surfaces
      .filter(([, body]) => body.toLowerCase().includes(phrase.toLowerCase()))
      .map(([name]) => name);
    expect(offenders).toEqual([]);
  });
});
