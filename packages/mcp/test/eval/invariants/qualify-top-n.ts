import type { MCPEvidence, InvariantResult } from "../helpers/evidence.js";

export function qualifyTopNInvariants(evidence: MCPEvidence): InvariantResult[] {
  const calls = evidence.tool_calls.map((c) => c.name);
  const bulkCall = evidence.tool_calls.find((c) => c.name === "leadbay_bulk_qualify_leads");
  const countArg =
    bulkCall &&
    typeof bulkCall.input === "object" &&
    bulkCall.input !== null &&
    "count" in bulkCall.input
      ? (bulkCall.input as { count: unknown }).count
      : undefined;
  const proseAll = evidence.final_agent_message;
  return [
    {
      name: "called_exactly_once.leadbay_bulk_qualify_leads",
      pass: calls.filter((c) => c === "leadbay_bulk_qualify_leads").length === 1,
    },
    {
      name: "bulk_qualify_count_matches_arg",
      pass: countArg === 10 || countArg === "10",
      reason: `expected count=10, observed ${JSON.stringify(countArg)}`,
    },
    { name: "never_called.leadbay_research_lead", pass: !calls.includes("leadbay_research_lead") },
    {
      name: "still_running_leads_named",
      pass: ["l8", "l9", "l10"].every((id) => proseAll.includes(id)),
      reason: "expected agent prose to name still_running lead_ids so user can poll",
    },
  ];
}
