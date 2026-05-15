import type { MCPEvidence, InvariantResult } from "../helpers/evidence.js";

const SANCTIONED_SOURCES = new Set(["gmail_message_id", "calendar_event_id", "user_confirmed"]);

export function logOutreachInvariants(evidence: MCPEvidence): InvariantResult[] {
  const reportCalls = evidence.tool_calls.filter((c) => c.name === "leadbay_report_outreach");
  const passCount = reportCalls.length === 1;

  // Check the verification.source on the single report_outreach call.
  let verificationOk = false;
  let leadIdMatches = false;
  if (reportCalls.length === 1) {
    const input = reportCalls[0].input as Record<string, unknown> | null;
    const verification = input?.verification as Record<string, unknown> | undefined;
    verificationOk =
      typeof verification?.source === "string" && SANCTIONED_SOURCES.has(verification.source as string);
    leadIdMatches = input?.lead_id === "lead_acme_001";
  }
  return [
    { name: "called_exactly_once.leadbay_report_outreach", pass: passCount },
    {
      name: "verification_source_in_sanctioned_set",
      pass: verificationOk,
      reason: verificationOk ? undefined : "verification.source missing or not one of gmail_message_id/calendar_event_id/user_confirmed",
    },
    {
      name: "lead_id_matches_user_input",
      pass: leadIdMatches,
      reason: leadIdMatches ? undefined : "lead_id passed to report_outreach did not match the prompt arg",
    },
  ];
}
