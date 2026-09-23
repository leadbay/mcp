/**
 * Audit: every tool that declared `routing` in its promptforge
 * frontmatter has the auto-emitted `## WHEN TO USE` block in the head of the
 * generated tool description, right behind `## WHAT IT DOES`.
 *
 * The head is the chunk every chat host loads even when truncating tool
 * descriptions. If routing falls below that bar, the agent misroutes on
 * small-context hosts. See /CLAUDE.md "Tool-description structure".
 *
 * The audit also cross-checks that every `anti_triggers[].route_to`
 * names a real registered tool — catches typos and renames.
 */

import { describe, it, expect } from "vitest";
import { ROUTING_EXAMPLES } from "@leadbay/core";
import {
  compositeReadTools,
  compositeWriteTools,
  granularReadTools,
  granularWriteTools,
  type Tool,
} from "@leadbay/core";

// Widened from 600 on 2026-09-22. `## WHAT IT DOES` now precedes
// `## WHEN TO USE` — OpenAI's plugin guidelines require a tool's description to
// state its purpose explicitly, and a description that opened with a
// trigger-phrase list did not. The longest short_description is ~490 chars, so
// the routing block starts at most ~510 chars later than it used to. Claude
// Code, the tightest host measured, truncates each description at 2,048 chars,
// so the pair still lands inside what every host loads.
const ROUTING_HEAD_WINDOW = 1100;

// User-facing tools we deliberately backfilled with routing frontmatter.
// The audit ensures none of them regresses. Other tools MAY add routing
// later — when they do, append here.
const TOOLS_WITH_ROUTING = new Set([
  "leadbay_prepare_outreach",
  "leadbay_account_status",
  "leadbay_add_leads_to_campaign",
  "leadbay_remove_leads_from_campaign",
  "leadbay_campaign_call_sheet",
  "leadbay_campaign_progression",
  "leadbay_create_campaign",
  "leadbay_dislike_lead",
  "leadbay_followups_map",
  "leadbay_like_lead",
  "leadbay_set_lead_status",
  "leadbay_list_campaigns",
  "leadbay_pull_followups",
  "leadbay_pull_leads",
  // MCP-first lead delivery. The registry is the file's own instruction
  // ("when they do, append here"); the behavioural assertions for these three
  // live in lead-delivery-routing-block.test.ts, which covers the cross-routing
  // and example counts this audit does not.
  "leadbay_find_new_leads",
  "leadbay_qualify_leads",
  "leadbay_lead_job_status",
  "leadbay_report_friction",
  "leadbay_send_feedback",
  "leadbay_research_lead_by_id",
  "leadbay_research_lead_by_name_fuzzy",
  "leadbay_scan_portfolio_signals",
  "leadbay_tour_plan",
  // leadbay_list_lens_seed_candidates is INTERNAL scaffolding for leadbay_extend_lens —
  // users never invoke it directly. Routing frontmatter still exists to help
  // the agent know when NOT to call it, but the ≥2-positive-example audit
  // doesn't apply because there is no user-facing trigger phrase.
  "leadbay_extend_lens",
  "leadbay_manage_lenses",
  "leadbay_new_lens",
  "leadbay_adjust_audience",
  "leadbay_refine_lead_targeting",
  "leadbay_get_qualification_questions",
  "leadbay_set_qualification_questions",
  "leadbay_get_lead_custom_fields",
  "leadbay_add_contact",
  "leadbay_remove_contact",
  "leadbay_pin_contact",
  "leadbay_unpin_contact",
  "leadbay_update_contact",
  "leadbay_account_history",
  "leadbay_get_artifact_runtime",
  "leadbay_getting_started",
  "leadbay_team_activity",
  "leadbay_set_telemetry",
  "leadbay_enrich_contacts",
]);

const ALL_TOOLS: Tool[] = [
  ...compositeReadTools,
  ...compositeWriteTools,
  ...granularReadTools,
  ...granularWriteTools,
];

const ALL_TOOL_NAMES = new Set(ALL_TOOLS.map((t) => t.name));

describe("audit: routing block in the description head", () => {
  it("every tool with declared routing has WHEN TO USE in the description head", () => {
    const violations: string[] = [];
    for (const t of ALL_TOOLS) {
      if (!TOOLS_WITH_ROUTING.has(t.name)) continue;
      const head = t.description.slice(0, ROUTING_HEAD_WINDOW);
      if (!head.includes("## WHEN TO USE")) {
        violations.push(
          `${t.name}: '## WHEN TO USE' missing from first ${ROUTING_HEAD_WINDOW} chars (description length ${t.description.length})`,
        );
      }
    }
    expect(
      violations,
      `Promptforge should auto-emit the routing block at the top of the description. See packages/promptforge/src/assembler.ts applyDescriptionHeader.`,
    ).toEqual([]);
  });

  it("every routed tool lists at least one trigger phrase", () => {
    const violations: string[] = [];
    for (const t of ALL_TOOLS) {
      if (!TOOLS_WITH_ROUTING.has(t.name)) continue;
      const head = t.description.slice(0, ROUTING_HEAD_WINDOW);
      if (!head.match(/Trigger phrases: "/)) {
        violations.push(`${t.name}: WHEN TO USE block has no trigger phrases`);
      }
    }
    expect(violations).toEqual([]);
  });


  it("every routed tool carries ≥2 positive AND ≥2 negative example messages", () => {
    // Community best-practice (Anthropic skill-author guide, mgechev/
    // skills-best-practices, writing-tools-for-agents) converges on
    // "3 realistic positives + 3 confusable negatives". We assert ≥2
    // of each — leaves room for a tool with naturally fewer angles
    // without losing the discriminative signal.
    const violations: string[] = [];
    // The examples are a test set, not description text: promptforge emits them
    // to ROUTING_EXAMPLES rather than into the head, where they cost 17,223
    // characters of the window a host keeps. The invariant is unchanged — every
    // routed tool still declares two of each — only its address moved.
    for (const t of ALL_TOOLS) {
      if (!TOOLS_WITH_ROUTING.has(t.name)) continue;
      const examples = ROUTING_EXAMPLES[t.name];
      const posCount = examples?.positive.length ?? 0;
      const negCount = examples?.negative.length ?? 0;
      if (posCount < 2) {
        violations.push(`${t.name}: only ${posCount} positive example(s) (need ≥2)`);
      }
      if (negCount < 2) {
        violations.push(`${t.name}: only ${negCount} negative example(s) (need ≥2)`);
      }
    }
    expect(
      violations,
      `Positive + negative examples train the agent to discriminate. See /CLAUDE.md "Routing examples".`,
    ).toEqual([]);
  });

  it("anti_triggers route_to references resolve to real registered tool names", () => {
    // Pull every `→ \`leadbay_*\`` reference out of the auto-emitted
    // routing blocks and confirm the target tool is registered. Catches
    // renames + typos.
    const offenders: Array<{ tool: string; refTo: string }> = [];
    const refRe = /→ `(leadbay_[a-z0-9_]+)`/g;
    for (const t of ALL_TOOLS) {
      const head = t.description.slice(0, ROUTING_HEAD_WINDOW * 2);
      for (const match of head.matchAll(refRe)) {
        const target = match[1];
        if (!ALL_TOOL_NAMES.has(target)) {
          offenders.push({ tool: t.name, refTo: target });
        }
      }
    }
    expect(
      offenders,
      `anti_triggers.route_to references a non-existent tool: ${JSON.stringify(offenders)}`,
    ).toEqual([]);
  });
});
