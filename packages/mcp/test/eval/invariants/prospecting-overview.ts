import type { MCPEvidence, InvariantResult } from "../helpers/evidence.js";

export function prospectingOverviewInvariants(evidence: MCPEvidence): InvariantResult[] {
  const calls = evidence.tool_calls.map((c) => c.name);
  const accountCount = calls.filter((c) => c === "leadbay_account_status").length;
  return [
    {
      name: "called_at_least_once.leadbay_account_status",
      pass: accountCount >= 1,
      reason: accountCount >= 1 ? undefined : "leadbay_account_status must be called to produce a factual overview",
    },
    {
      name: "never_called.leadbay_report_outreach",
      pass: !calls.includes("leadbay_report_outreach"),
      reason: calls.includes("leadbay_report_outreach")
        ? "overview prompt must not log outreach unilaterally"
        : undefined,
    },
  ];
}
