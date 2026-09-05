/**
 * Leadbay has no cancel. Once an enrichment, qualification or import launch
 * returns, the backend runs it to completion and the quota it costs is already
 * committed — there is no cancel, stop or abort route for any of the three
 * (`LeadsRoutes.kt`, `ImportsRoutes.kt`, and the `/1.6` specs).
 *
 * The MCP used to tell the agent the opposite: a host cancellation flipped a
 * local record to `cancelled`, and the status tools answered "no further work
 * is in flight … relaunch". Following that spends the user's quota a second
 * time on rows Leadbay is still processing.
 *
 * Three variants ship, because three kinds of tool exist, and handing a tool
 * the wrong one is its own bug:
 *
 *  - GUARDED launchers call `beginLaunch`, so a re-call inside the window hands
 *    back the job already launched. Best-effort, never a guarantee.
 *  - POLL_ONLY status tools launch nothing. Re-calling them is free, and text
 *    that warns about spending quota on a retry would stall the polling loop
 *    they exist for.
 *  - UNGUARDED launchers POST directly with no guard at all, so the guarded
 *    re-call advice would buy a second paid launch.
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

const GUARDED_TOOLS = [
  "leadbay_enrich_titles",
  "leadbay_bulk_qualify_leads",
  "leadbay_import_and_qualify",
] as const;

const POLL_ONLY_TOOLS = [
  "leadbay_bulk_enrich_status",
  "leadbay_qualify_status",
  "leadbay_import_status",
] as const;

// Advanced-gated single POSTs. Each spends quota, and none calls `beginLaunch`.
// `leadbay_enrich_contacts` is also exposed on the hosted route.
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

// The snippets are hard-wrapped markdown, so a sentence can straddle a newline.
// Match on collapsed whitespace or the audit breaks every time someone rewraps
// a paragraph without changing a word of it.
const flat = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ");
const says = (tool: string, phrase: string) =>
  expect(flat(byName.get(tool)), tool).toContain(phrase.replace(/\s+/g, " "));
const doesNotSay = (tool: string, phrase: string) =>
  expect(flat(byName.get(tool)), tool).not.toContain(phrase.replace(/\s+/g, " "));

const PROMPT_TEXTS: Array<[string, string]> = Object.entries(prompts).filter(
  (e): e is [string, string] => typeof e[1] === "string"
);

const EVERY_TOOL = [...GUARDED_TOOLS, ...POLL_ONLY_TOOLS, ...UNGUARDED_TOOLS];

describe("a launched job cannot be stopped — every tool is told so", () => {
  it.each([...EVERY_TOOL, "leadbay_import_leads"])("%s says Leadbay has no cancel", (tool) => {
    expect(byName.get(tool), `${tool} is not a registered tool`).toBeTypeOf("string");
    says(tool, "Leadbay has no cancel");
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

describe("guarded launchers get all three recovery branches", () => {
  it.each(GUARDED_TOOLS)("%s scopes the rule to a launched result", (tool) => {
    says(tool, "dry_run` result launched nothing and is not covered here");
  });

  it.each(GUARDED_TOOLS)("%s says a handle is polled, not relaunched", (tool) => {
    says(tool, "do not launch the work that handle covers a second time");
  });

  it.each(GUARDED_TOOLS)("%s permits re-running a never-started subset", (tool) => {
    says(tool, 'error:"not_queued"');
    says(tool, "re-run for that subset only");
  });

  // The guard is in-memory, five minutes, per process, and the blocking qualify
  // path never enters it. Promising recovery it cannot deliver is how a lost
  // launch response turns into a second charge.
  it.each(GUARDED_TOOLS)("%s calls the double-launch guard best-effort", (tool) => {
    says(tool, "hand back the job already launched");
    says(tool, "best-effort");
  });
});

describe("status tools are told polling is free", () => {
  it.each(POLL_ONLY_TOOLS)("%s says re-calling it launches nothing", (tool) => {
    says(tool, "This tool only reads");
    says(tool, "launches nothing and spends no quota");
    says(tool, "a timeout here is a reason to call it again, not a reason to stop");
  });

  // The launcher text would tell a status tool to check account_status and warn
  // the user before "spending quota" on a retry. There is no quota to spend,
  // and hesitating breaks the poll loop these tools exist for.
  it.each(POLL_ONLY_TOOLS)("%s does not carry the launcher retry warning", (tool) => {
    doesNotSay(tool, "hand back the job already launched");
    doesNotSay(tool, "before you spend the user's quota on it");
  });
});

describe("unguarded launchers are told they have no guard", () => {
  it.each(UNGUARDED_TOOLS)("%s warns every call is a new paid launch", (tool) => {
    says(tool, "no double-launch guard");
    says(tool, "calling it again always issues a new paid launch");
  });

  it.each(UNGUARDED_TOOLS)("%s exempts a dry run from the quota claim", (tool) => {
    says(tool, "`dry_run` result reached no backend and spent nothing");
  });

  it.each(UNGUARDED_TOOLS)("%s does not promise the guarded re-call", (tool) => {
    doesNotSay(tool, "hand back the job already launched");
  });
});

describe("leadbay_import_leads carries its own sentence", () => {
  it("states the cancel case and the branches its own paragraph already has", () => {
    says("leadbay_import_leads", "Do NOT call leadbay_import_leads again");
    says("leadbay_import_leads", "rows_pending_upload");
  });

  // `rememberLaunch` is reached only after EVERY chunk uploads, and the catch
  // calls `abandonLaunch`, so the re-call returns the same ids for a
  // single-chunk file and can re-upload a larger one.
  it("does not promise handle recovery for a multi-chunk file", () => {
    says("leadbay_import_leads", "Sole exception: a `wait_for_completion:false` call that returned NOTHING");
    says("leadbay_import_leads", "even that can re-upload");
    doesNotSay("leadbay_import_leads", "for five minutes it returns the same");
    doesNotSay("leadbay_import_leads", "gives back the same `importIds`");
  });
});

describe("the old, false model is not reachable from any generated surface", () => {
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
