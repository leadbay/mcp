import type { MCPEvidence, InvariantResult } from "../helpers/evidence.js";

function calledExactly(evidence: MCPEvidence, name: string): InvariantResult {
  const count = evidence.tool_calls.filter((c) => c.name === name).length;
  return {
    name: `called_exactly_once.${name}`,
    pass: count === 1,
    reason: count === 1 ? undefined : `expected 1, observed ${count}`,
  };
}

function neverCalled(evidence: MCPEvidence, name: string): InvariantResult {
  const count = evidence.tool_calls.filter((c) => c.name === name).length;
  return {
    name: `never_called.${name}`,
    pass: count === 0,
    reason: count === 0 ? undefined : `forbidden tool was called ${count} times`,
  };
}

function callSheetUsesSelectedCampaign(evidence: MCPEvidence): InvariantResult {
  const call = evidence.tool_calls.find((c) => c.name === "leadbay_campaign_call_sheet");
  const input = call?.input as Record<string, unknown> | undefined;
  const pass = input?.campaign_id === "camp_q2_push";
  return {
    name: "call_sheet_uses_selected_campaign",
    pass,
    reason: pass
      ? undefined
      : `expected campaign_id=camp_q2_push, observed ${String(input?.campaign_id)}`,
  };
}

function listBeforeCallSheet(evidence: MCPEvidence): InvariantResult {
  const names = evidence.tool_calls.map((c) => c.name);
  const listIdx = names.indexOf("leadbay_list_campaigns");
  const sheetIdx = names.indexOf("leadbay_campaign_call_sheet");
  const pass = listIdx >= 0 && sheetIdx > listIdx;
  return {
    name: "list_campaigns_before_call_sheet",
    pass,
    reason: pass
      ? undefined
      : `expected leadbay_list_campaigns before leadbay_campaign_call_sheet, observed ${names.join(" -> ")}`,
  };
}

export function workCampaignInvariants(evidence: MCPEvidence): InvariantResult[] {
  return [
    calledExactly(evidence, "leadbay_list_campaigns"),
    calledExactly(evidence, "leadbay_campaign_call_sheet"),
    callSheetUsesSelectedCampaign(evidence),
    listBeforeCallSheet(evidence),
    neverCalled(evidence, "leadbay_campaign_progression"),
    neverCalled(evidence, "leadbay_report_outreach"),
    neverCalled(evidence, "leadbay_enrich_titles"),
  ];
}
