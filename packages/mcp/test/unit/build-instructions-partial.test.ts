/**
 * buildServerInstructions — partial-exposure branches.
 *
 * The existing server.test.ts matrix covers FULL_EXPOSURE and READ_ONLY but not
 * the in-between branches that fire when an operator wires up a custom subset
 * of composite write tools. These branches matter because the system prompt
 * names tools by literal identifier — a regression that drops or doubles a
 * tool name silently breaks the LLM's intent-to-tool mapping.
 *
 * Branches verified here (matching server.ts:36-99):
 *   1. Scoring paragraph trailing sentence — only bulk_qualify_leads exposed
 *      (singular "Call X" form, no "or enrich_titles")
 *   2. Scoring paragraph trailing sentence — only enrich_titles exposed
 *      (singular "Call X for contacts")
 *   3. Scoring paragraph trailing sentence — neither exposed
 *      (no trailing "Call …" sentence at all)
 *   4. Start-here composite list — partial subset (refine_prompt only)
 *      (only the names actually exposed appear in the parenthetical list)
 *   5. Rhythm paragraph — report_outreach absent
 *      (no "leadbay_report_outreach" mention; "propose outreach to the user." closes the line)
 */
import { describe, it, expect } from "vitest";
import { buildServerInstructions } from "../../src/server.js";

const READS = [
  "leadbay_account_status",
  "leadbay_pull_leads",
  "leadbay_research_lead_by_id",
  "leadbay_recall_ordered_titles",
];

describe("buildServerInstructions — partial composite-write exposures", () => {
  it("only bulk_qualify_leads exposed → singular deepening sentence (no 'or enrich_titles')", () => {
    const exposed = new Set([...READS, "leadbay_bulk_qualify_leads"]);
    const out = buildServerInstructions(exposed);
    // Trailing sentence references bulk_qualify_leads…
    expect(out).toMatch(/Call leadbay_bulk_qualify_leads for deeper qualification/);
    // …but does NOT mention enrich_titles (would be a name-injection regression).
    expect(out).not.toMatch(/enrich_titles/);
    // No " or " conjunction in the deepening sentence — would be a stray join.
    expect(out).not.toMatch(/qualification or /);
  });

  it("only enrich_titles exposed → singular deepening sentence (no 'or bulk_qualify_leads')", () => {
    const exposed = new Set([...READS, "leadbay_enrich_titles"]);
    const out = buildServerInstructions(exposed);
    expect(out).toMatch(/Call leadbay_enrich_titles for contacts/);
    expect(out).not.toMatch(/bulk_qualify_leads/);
    expect(out).not.toMatch(/contacts or /);
  });

  it("neither qualifier nor enricher exposed → scoring paragraph drops the trailing 'Call …' sentence", () => {
    const out = buildServerInstructions(new Set(READS));
    // Base scoring text still present.
    expect(out).toMatch(/two scoring layers/i);
    expect(out).toMatch(/ai_agent_lead_score/);
    // No "Call leadbay_… on any lead" trailer when nothing to deepen with.
    expect(out).not.toMatch(/Call leadbay_/);
  });

  it("partial composite write subset (refine_prompt only) → only that name appears in the start-here list", () => {
    const exposed = new Set([
      ...READS,
      "leadbay_refine_prompt",
      "leadbay_report_outreach", // present so the verification mandate stays out of the start-here paragraph
    ]);
    const out = buildServerInstructions(exposed);
    // Start-here paragraph names refine_prompt in the composite list…
    expect(out).toMatch(/refine_prompt/);
    // …but not the other composite-write names that are NOT exposed.
    expect(out).not.toMatch(/bulk_qualify_leads/);
    expect(out).not.toMatch(/adjust_audience/);
    expect(out).not.toMatch(/enrich_titles/);
    // The fallback "those actions require write tools" prose must NOT fire when at least
    // one composite is exposed.
    expect(out).not.toMatch(/those actions require write tools/);
  });

  it("report_outreach absent → rhythm paragraph drops the report_outreach mention", () => {
    const exposed = new Set([
      ...READS,
      "leadbay_bulk_qualify_leads",
      "leadbay_enrich_titles",
      // intentionally omitted: leadbay_report_outreach
    ]);
    const out = buildServerInstructions(exposed);
    // Verification mandate must not leak in (it's gated on report_outreach).
    expect(out.slice(0, 200)).not.toMatch(/report_outreach/i);
    // Rhythm line still says "propose outreach to the user" but does NOT
    // chain "then leadbay_report_outreach".
    expect(out).toMatch(/propose outreach to the user/);
    expect(out).not.toMatch(/leadbay_report_outreach/);
  });

  it("report_friction absent → friction mandate paragraph is dropped", () => {
    // Friction tool stripped from the exposed set. Mirrors the
    // verification-mandate gate: a host that doesn't expose the tool
    // must not see an ambient instruction naming a tool it can't call.
    const exposed = new Set(READS);
    const out = buildServerInstructions(exposed);
    expect(out).not.toMatch(/leadbay_report_friction/);
    expect(out).not.toMatch(/Silent friction capture/);
  });

  it("report_friction exposed → friction paragraph fires", () => {
    const exposed = new Set([...READS, "leadbay_report_friction"]);
    const out = buildServerInstructions(exposed);
    expect(out).toMatch(/Problem reports:/);
    expect(out).toMatch(/leadbay_report_friction/);
  });
});
