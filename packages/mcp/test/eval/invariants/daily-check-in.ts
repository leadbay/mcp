/**
 * Invariants for the daily_check_in prompt — pure functions over MCPEvidence
 * that return InvariantResult[].
 *
 * Invariants are deterministic; if any fail the test fails before the LLM
 * judge runs. They encode the structural contract of the prompt: which
 * tools fire, in what order, and which byproducts appear in agent prose.
 */
import type { MCPEvidence, InvariantResult } from "../helpers/evidence.js";

function calledExactly(evidence: MCPEvidence, name: string): InvariantResult {
  const count = evidence.tool_calls.filter((c) => c.name === name).length;
  return {
    name: `called_exactly_once.${name}`,
    pass: count === 1,
    reason: count === 1 ? undefined : `expected 1, observed ${count}`,
  };
}

function calledAtLeastOnce(evidence: MCPEvidence, name: string): InvariantResult {
  const count = evidence.tool_calls.filter((c) => c.name === name).length;
  return {
    name: `called_at_least_once.${name}`,
    pass: count >= 1,
    reason: count >= 1 ? undefined : `expected ≥1, observed ${count}`,
  };
}

function calledAtLeastN(evidence: MCPEvidence, name: string, n: number): InvariantResult {
  const count = evidence.tool_calls.filter((c) => c.name === name).length;
  return {
    name: `called_at_least_${n}.${name}`,
    pass: count >= n,
    reason: count >= n ? undefined : `expected ≥${n}, observed ${count}`,
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

function calledInOrder(evidence: MCPEvidence, sequence: string[]): InvariantResult {
  const observed: string[] = [];
  for (const c of evidence.tool_calls) {
    if (sequence.includes(c.name)) observed.push(c.name);
  }
  const want = [...sequence];
  let i = 0;
  for (const name of want) {
    const idx = observed.indexOf(name, i);
    if (idx === -1) {
      return {
        name: "called_in_order",
        pass: false,
        reason: `sequence ${sequence.join(" → ")} not observed (got: ${observed.join(", ")})`,
      };
    }
    i = idx + 1;
  }
  return { name: "called_in_order", pass: true };
}

function containsByproduct(evidence: MCPEvidence, needle: string): InvariantResult {
  const haystack =
    evidence.final_agent_message + "\n" +
    evidence.prose_between_tool_calls.map((p) => p.text).join("\n");
  return {
    name: `byproduct_present.${needle.slice(0, 30)}`,
    pass: haystack.includes(needle),
    reason: haystack.includes(needle) ? undefined : `expected phrase not in agent prose: "${needle}"`,
  };
}

function neverCalledBeforeUserConfirmation(
  evidence: MCPEvidence,
  name: string,
): InvariantResult {
  // Contact enrichment must be ASKED-FOR before being called. We can't observe
  // the user's response from inside an eval session, so the conservative
  // invariant is: in a single-turn-from-the-user scenario, the agent must NOT
  // call enrich_contacts unilaterally. Real user-confirms-yes flows live in a
  // separate scenario.
  const count = evidence.tool_calls.filter((c) => c.name === name).length;
  return {
    name: `never_called_unilaterally.${name}`,
    pass: count === 0,
    reason:
      count === 0
        ? undefined
        : `${name} was called without an explicit user-confirmation turn (consumes quota)`,
  };
}

export function dailyCheckInInvariants(evidence: MCPEvidence): InvariantResult[] {
  return [
    calledExactly(evidence, "leadbay_account_status"),
    calledExactly(evidence, "leadbay_pull_leads"),
    // PHASE 4 expects research on every promising lead — at least one call,
    // and typically multiple. We assert ≥1 (covers the small-batch case where
    // only 1 lead is worth deep-diving) but flag if exactly 1 happens on a
    // batch with many leads via the judge rubric, not here.
    calledAtLeastOnce(evidence, "leadbay_research_lead"),
    neverCalled(evidence, "leadbay_report_outreach"),
    neverCalledBeforeUserConfirmation(evidence, "leadbay_enrich_contacts"),
    calledInOrder(evidence, [
      "leadbay_account_status",
      "leadbay_pull_leads",
      "leadbay_research_lead",
    ]),
    containsByproduct(evidence, "STOP — awaiting user decision"),
  ];
}
