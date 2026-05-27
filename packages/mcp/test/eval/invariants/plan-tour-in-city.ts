import type { MCPEvidence, InvariantResult } from "../helpers/evidence.js";

export function planTourInCityInvariants(evidence: MCPEvidence): InvariantResult[] {
  const calls = evidence.tool_calls.map((c) => c.name);
  const tourCount = calls.filter((c) => c === "leadbay_tour_plan").length;
  return [
    {
      name: "called_at_least_once.leadbay_tour_plan",
      pass: tourCount >= 1,
      reason: tourCount >= 1 ? undefined : "leadbay_tour_plan must be called to build the mixed-mode city itinerary",
    },
    {
      name: "never_called.leadbay_pull_leads_standalone",
      pass: !calls.includes("leadbay_pull_leads"),
      reason: calls.includes("leadbay_pull_leads")
        ? "agent must call leadbay_tour_plan (not raw leadbay_pull_leads) for the geo-filtered mix"
        : undefined,
    },
    {
      name: "never_called.leadbay_report_outreach",
      pass: !calls.includes("leadbay_report_outreach"),
      reason: calls.includes("leadbay_report_outreach")
        ? "tour planning must not log outreach unilaterally"
        : undefined,
    },
  ];
}
