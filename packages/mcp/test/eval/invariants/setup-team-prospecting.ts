import type { MCPEvidence, InvariantResult } from "../helpers/evidence.js";

export function setupTeamProspectingInvariants(evidence: MCPEvidence): InvariantResult[] {
  const calls = evidence.tool_calls.map((c) => c.name);
  const pullLeadsCount = calls.filter((c) => c === "leadbay_pull_leads").length;
  const createCampaignCount = calls.filter((c) => c === "leadbay_create_campaign").length;
  return [
    {
      name: "called_at_least_once.leadbay_pull_leads",
      pass: pullLeadsCount >= 1,
      reason: pullLeadsCount >= 1 ? undefined : "must validate lens by calling leadbay_pull_leads",
    },
    {
      name: "called_at_least_once.leadbay_create_campaign",
      pass: createCampaignCount >= 1,
      reason: createCampaignCount >= 1 ? undefined : "must persist at least one named campaign",
    },
    {
      name: "never_called.leadbay_report_outreach",
      pass: !calls.includes("leadbay_report_outreach"),
      reason: calls.includes("leadbay_report_outreach")
        ? "setup flow must not log outreach unilaterally"
        : undefined,
    },
  ];
}
