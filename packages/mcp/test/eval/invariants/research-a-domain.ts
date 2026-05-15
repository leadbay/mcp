import type { MCPEvidence, InvariantResult } from "../helpers/evidence.js";

export function researchADomainInvariants(evidence: MCPEvidence): InvariantResult[] {
  const calls = evidence.tool_calls.map((c) => c.name);
  const importCall = evidence.tool_calls.find((c) => c.name === "leadbay_import_and_qualify");
  const importHasDomainArg =
    importCall &&
    typeof importCall.input === "object" &&
    importCall.input !== null &&
    "domains" in importCall.input;
  return [
    { name: "called_at_least_once.leadbay_import_and_qualify", pass: calls.includes("leadbay_import_and_qualify") },
    { name: "called_at_least_once.leadbay_research_lead", pass: calls.includes("leadbay_research_lead") },
    {
      name: "import_and_qualify_received_domains_arg",
      pass: Boolean(importHasDomainArg),
      reason: importHasDomainArg ? undefined : "import_and_qualify input did not contain a 'domains' array",
    },
    {
      name: "called_in_order.import_then_research",
      pass:
        calls.indexOf("leadbay_import_and_qualify") !== -1 &&
        calls.indexOf("leadbay_research_lead") > calls.indexOf("leadbay_import_and_qualify"),
    },
  ];
}
