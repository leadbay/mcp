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
// `leadbay_import_leads` is not here: it sits ~150 chars from the 17,000 cap,
// and its own SLOW BACKEND paragraph already carries the handle and the
// never-uploaded-subset branches in its own terms. It states the cancel case in
// one sentence instead, asserted separately below.
const BULK_TOOLS = [
  "leadbay_enrich_titles",
  "leadbay_bulk_qualify_leads",
  "leadbay_import_and_qualify",
  "leadbay_bulk_enrich_status",
  "leadbay_qualify_status",
  "leadbay_import_status",
] as const;

// Advanced-gated single POSTs. Each spends quota, and none of them calls
// `beginLaunch`, so the guarded "re-call and get the same job back" advice is
// false for them — they carry the unguarded variant instead.
const UNGUARDED_TOOLS = [
  "leadbay_qualify_lead",
  "leadbay_enrich_contacts",
  "leadbay_launch_bulk_enrichment",
] as const;

const ALL_TOOLS: Tool[] = [
  ...compositeReadTools,
  ...compositeWriteTools,
  ...granularReadTools,
  ...granularWriteTools,
];

const byName = new Map(ALL_TOOLS.map((t) => [t.name, t.description]));

// The snippet is hard-wrapped markdown, so a sentence can straddle a newline.
// Match on collapsed whitespace or the audit breaks every time someone rewraps
// a paragraph without changing a word of it.
const flat = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ");
const says = (tool: string, phrase: string) =>
  expect(flat(byName.get(tool))).toContain(phrase.replace(/\s+/g, " "));

const PROMPT_TEXTS: Array<[string, string]> = Object.entries(prompts).filter(
  (e): e is [string, string] => typeof e[1] === "string"
);

describe("a launched job cannot be stopped — the agent is told so", () => {
  it.each(BULK_TOOLS)("%s states that Leadbay has no cancel", (tool) => {
    const text = byName.get(tool);
    expect(text, `${tool} is not a registered tool`).toBeTypeOf("string");
    says(tool, "Leadbay has no cancel");
  });

  it.each(BULK_TOOLS)("%s says a handle must be polled, not relaunched", (tool) => {
    says(tool, "do not launch the work that handle covers a second time");
  });

  // The rule branches, and each branch is load-bearing: an absolute "never
  // relaunch" strands a call that timed out before it returned a handle, and
  // an unconditional "quota is committed" is wrong for a discovery, preview or
  // dry-run result that launched nothing.
  it.each(BULK_TOOLS)("%s scopes the rule to a launched result", (tool) => {
    says(tool, "dry_run` result launched nothing and is not covered here");
  });

  it.each(BULK_TOOLS)("%s tells a handle-less caller to re-call, not to give up", (tool) => {
    says(tool, "hand back the job already launched");
  });

  // The guard is in-memory, five minutes, per process, and the blocking
  // qualify path never enters it. Promising recovery it cannot deliver is how
  // a lost launch response turns into a second charge.
  it.each(BULK_TOOLS)("%s calls the double-launch guard best-effort", (tool) => {
    says(tool, "best-effort");
  });

  // A running handle can ship alongside leads or rows that were never queued.
  it.each(BULK_TOOLS)("%s permits re-running a never-started subset", (tool) => {
    says(tool, 'error:"not_queued"');
    says(tool, "re-run for that subset only");
  });

  it.each(UNGUARDED_TOOLS)("%s says Leadbay has no cancel", (tool) => {
    expect(byName.get(tool), `${tool} is not a registered tool`).toBeTypeOf("string");
    says(tool, "Leadbay has no cancel");
  });

  it.each(UNGUARDED_TOOLS)("%s warns it has no double-launch guard", (tool) => {
    says(tool, "no double-launch guard");
    says(tool, "calling it again always issues a new paid launch");
  });

  it.each(UNGUARDED_TOOLS)("%s does not promise the guarded re-call", (tool) => {
    expect(flat(byName.get(tool))).not.toContain("hand back the job already launched");
  });

  it("leadbay_import_leads states the cancel case in its own paragraph", () => {
    says("leadbay_import_leads", "Leadbay has no cancel");
    // The branches it does carry, from its own SLOW BACKEND paragraph.
    says("leadbay_import_leads", "Do NOT call leadbay_import_leads again");
    says("leadbay_import_leads", "rows_pending_upload");
    // The P1 the snippet would otherwise have carried here: a call that
    // returned no handle at all must be re-called, and the async path's guard
    // gives back the same importIds.
    says("leadbay_import_leads", "re-call it identically");
    says("leadbay_import_leads", "returns the same `importIds`");
  });

  it("every prompt carrying the long-running rules carries this one too", () => {
    const carriers = PROMPT_TEXTS.filter(([, body]) =>
      body.includes("Resilience rules for Leadbay long-running tools")
    );
    expect(carriers.length).toBeGreaterThan(0);
    for (const [name, body] of carriers) {
      expect(flat(body), `prompt ${name}`).toContain("Leadbay has no cancel");
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
