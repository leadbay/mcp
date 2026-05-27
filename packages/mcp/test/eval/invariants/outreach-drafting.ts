import type { MCPEvidence, InvariantResult } from "../helpers/evidence.js";

export function outreachDraftingInvariants(evidence: MCPEvidence): InvariantResult[] {
  const calls = evidence.tool_calls.map((c) => c.name);
  const prepareCount = calls.filter((c) => c === "leadbay_prepare_outreach").length;
  return [
    {
      name: "called_at_least_once.leadbay_prepare_outreach",
      pass: prepareCount >= 1,
      reason: prepareCount >= 1 ? undefined : "leadbay_prepare_outreach must be called to assemble the outreach brief",
    },
    {
      name: "never_called.leadbay_report_outreach",
      pass: !calls.includes("leadbay_report_outreach"),
      reason: calls.includes("leadbay_report_outreach")
        ? "outreach drafting must not log outreach — that is a separate user-initiated step"
        : undefined,
    },
  ];
}
