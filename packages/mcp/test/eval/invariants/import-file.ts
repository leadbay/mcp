/**
 * Invariants for the leadbay_import_file prompt.
 *
 * Per the prompt's phases/gates structure: every required byproduct must
 * appear in agent prose BEFORE the corresponding tool call fires. The
 * order check is critical — emitting COLUMN PRESERVATION PLAN at the
 * end of the session doesn't satisfy the gate; it must happen before
 * leadbay_resolve_import_rows.
 */
import type { MCPEvidence, InvariantResult } from "../helpers/evidence.js";

function findFirstCallIndex(evidence: MCPEvidence, name: string): number {
  for (let i = 0; i < evidence.tool_calls.length; i++) {
    if (evidence.tool_calls[i].name === name) return i;
  }
  return -1;
}

function proseBeforeCall(evidence: MCPEvidence, callIndex: number): string {
  if (callIndex < 0) return "";
  const callTurn = evidence.tool_calls[callIndex].turn;
  return evidence.prose_between_tool_calls
    .filter((p) => p.after_turn < callTurn)
    .map((p) => p.text)
    .join("\n");
}

function byproductBeforeCall(
  evidence: MCPEvidence,
  byproduct: string,
  beforeCall: string,
): InvariantResult {
  const idx = findFirstCallIndex(evidence, beforeCall);
  if (idx === -1) {
    // The required call didn't fire — separate invariant will catch it.
    return {
      name: `byproduct_before.${byproduct.slice(0, 20)}_before_${beforeCall}`,
      pass: false,
      reason: `tool ${beforeCall} did not fire; cannot verify byproduct ordering`,
    };
  }
  const prose = proseBeforeCall(evidence, idx);
  return {
    name: `byproduct_before.${byproduct.slice(0, 20)}_before_${beforeCall}`,
    pass: prose.includes(byproduct),
    reason: prose.includes(byproduct)
      ? undefined
      : `byproduct "${byproduct}" missing from prose before ${beforeCall}`,
  };
}

function calledAtLeastOnce(evidence: MCPEvidence, name: string): InvariantResult {
  const count = evidence.tool_calls.filter((c) => c.name === name).length;
  return {
    name: `called_at_least_once.${name}`,
    pass: count >= 1,
    reason: count >= 1 ? undefined : "never fired",
  };
}

function noLeadNameWithCampaignSuffix(evidence: MCPEvidence): InvariantResult {
  // Look at every leadbay_resolve_import_rows or leadbay_import_* call
  // and inspect the records/rows payload for stray campaign suffixes.
  const suffixPattern = /\b(BYOC|DD|Uber)\b/;
  const offending: string[] = [];
  for (const call of evidence.tool_calls) {
    if (!/import|resolve/.test(call.name)) continue;
    const serialized = JSON.stringify(call.input ?? {});
    // Only flag if the substring appears inside a LEAD_NAME-shaped position.
    // Cheap heuristic: any token that says LEAD_NAME or "name" near a suffix.
    if (suffixPattern.test(serialized) && /LEAD_NAME|"name"/.test(serialized)) {
      offending.push(call.name);
    }
  }
  return {
    name: "no_campaign_suffix_in_lead_name",
    pass: offending.length === 0,
    reason:
      offending.length === 0
        ? undefined
        : `campaign suffix tokens leaked into LEAD_NAME in: ${offending.join(", ")}`,
  };
}

function containsFinalReport(evidence: MCPEvidence): InvariantResult {
  return {
    name: "byproduct_present.FINAL_REPORT",
    pass: evidence.final_agent_message.includes("FINAL REPORT"),
    reason: evidence.final_agent_message.includes("FINAL REPORT")
      ? undefined
      : "FINAL REPORT block missing from final agent message",
  };
}

function neverCalled(evidence: MCPEvidence, name: string): InvariantResult {
  const count = evidence.tool_calls.filter((c) => c.name === name).length;
  return {
    name: `never_called.${name}`,
    pass: count === 0,
    reason: count === 0 ? undefined : `forbidden tool fired ${count} times`,
  };
}

export function importFileInvariants(evidence: MCPEvidence): InvariantResult[] {
  return [
    calledAtLeastOnce(evidence, "leadbay_resolve_import_rows"),
    byproductBeforeCall(evidence, "COLUMN PRESERVATION PLAN", "leadbay_resolve_import_rows"),
    byproductBeforeCall(evidence, "DECISION LOG", "leadbay_import_and_qualify"),
    noLeadNameWithCampaignSuffix(evidence),
    containsFinalReport(evidence),
    neverCalled(evidence, "leadbay_report_outreach"),
  ];
}
