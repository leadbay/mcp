/**
 * Invariants for leadbay_followup_check_in.
 *
 * The hard contract: the agent MUST call leadbay_pull_followups (Monitor
 * view) and MUST NOT call leadbay_pull_leads (Discover wishlist) — the
 * two entry points read from different backend tables. The classic
 * regression is iterating pages of pull_leads filtering by engagement
 * counters to fake a follow-up view.
 */
import type { MCPEvidence, InvariantResult } from "../helpers/evidence.js";

export function followupCheckInInvariants(evidence: MCPEvidence): InvariantResult[] {
  const calls = evidence.tool_calls.map((c) => c.name);
  const followupCount = calls.filter((c) => c === "leadbay_pull_followups").length;
  const pullLeadsCount = calls.filter((c) => c === "leadbay_pull_leads").length;
  return [
    {
      name: "called_at_least_once.leadbay_pull_followups",
      pass: followupCount >= 1,
      reason: followupCount >= 1 ? undefined : "expected ≥1 leadbay_pull_followups call (Monitor view)",
    },
    {
      name: "never_called.leadbay_pull_leads",
      pass: pullLeadsCount === 0,
      reason:
        pullLeadsCount === 0
          ? undefined
          : `leadbay_pull_leads was called ${pullLeadsCount}x — Discover wishlist is the wrong entry point for follow-up queries`,
    },
    {
      name: "never_called.leadbay_report_outreach",
      pass: !calls.includes("leadbay_report_outreach"),
    },
    {
      name: "byproduct_present.STOP",
      pass: (
        evidence.final_agent_message + "\n" +
        evidence.prose_between_tool_calls.map((p) => p.text).join("\n")
      ).includes("STOP — awaiting user decision"),
      reason: "expected the STOP byproduct so the agent hands control back to the user",
    },
  ];
}
