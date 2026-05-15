import type { MCPEvidence, InvariantResult } from "../helpers/evidence.js";

export function refineAudienceInvariants(evidence: MCPEvidence): InvariantResult[] {
  const calls = evidence.tool_calls.map((c) => c.name);
  const finalProse =
    evidence.final_agent_message +
    "\n" +
    evidence.prose_between_tool_calls.map((p) => p.text).join("\n");
  return [
    { name: "called_exactly_once.leadbay_refine_prompt", pass: calls.filter((c) => c === "leadbay_refine_prompt").length === 1 },
    { name: "never_called.leadbay_answer_clarification", pass: !calls.includes("leadbay_answer_clarification") },
    {
      name: "clarification_question_surfaced_verbatim",
      pass: finalProse.includes(
        "By 'their own IT', do you mean self-hosted EMR, in-house infrastructure team, or both?",
      ),
      reason: "expected clarification question to appear verbatim in agent prose",
    },
  ];
}
