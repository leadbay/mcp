import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext, AiAgentQuestionPayload } from "../types.js";
import { withAgentMemoryMeta } from "../agent-memory/index.js";

import { leadbay_set_qualification_methods as SET_QUALIFICATION_METHODS_DESCRIPTION } from "../tool-descriptions.generated.js";

interface SetQualificationMethodsParams {
  // Full replacement list. Mutually exclusive with add/remove.
  questions?: string[];
  // Append these (deduped against current). Mutually exclusive with `questions`.
  add?: string[];
  // Remove these exact question strings. Mutually exclusive with `questions`.
  remove?: string[];
  // Required when the resulting list is SHORTER than the current one
  // (a removal / shrinking replace drops questions the AI scores against).
  confirm?: boolean;
}

// Modify the org's qualification methods (the AI-agent questions every lead is
// scored against). Wire: POST /organizations/{orgId} with
// {ai_agent_lead_questions: [string, ...]} → 204. The endpoint is a FULL
// REPLACE, so this tool reads the current list, applies the requested change
// (set / add / remove), and posts the whole resulting array. Shrinking the
// list requires confirm:true (removing a question changes how every lead is
// scored).
export const setQualificationMethods: Tool<SetQualificationMethodsParams> = {
  name: "leadbay_set_qualification_methods",
  annotations: {
    title: "Modify the org's qualification methods",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  description: SET_QUALIFICATION_METHODS_DESCRIPTION,
  write: true,
  inputSchema: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        items: { type: "string" },
        description:
          "Full replacement list of qualification questions (replaces ALL current questions). Mutually exclusive with add/remove.",
      },
      add: {
        type: "array",
        items: { type: "string" },
        description:
          "Questions to append to the current list (deduped). Mutually exclusive with `questions`.",
      },
      remove: {
        type: "array",
        items: { type: "string" },
        description:
          "Exact question strings to remove from the current list. Mutually exclusive with `questions`. A removal requires confirm:true.",
      },
      confirm: {
        type: "boolean",
        description:
          "Required when the resulting list is SHORTER than the current one (removing questions changes how every lead is scored). Without it, such a change is previewed and not applied.",
      },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      qualification_questions: {
        type: "array",
        description: "The questions AFTER the change. Each: {question}.",
        items: { type: "object" },
      },
      count: { type: "number" },
      previous_count: { type: "number" },
      changed: {
        type: "boolean",
        description: "True when the list was actually written; false on a no-op or an unconfirmed shrink.",
      },
      region: { type: "string" },
      hint: {
        type: "string",
        description: "Operator note — confirm prompt on a shrink, or a no-op explanation.",
      },
      _meta: { type: "object" },
    },
    required: ["qualification_questions", "count", "changed"],
  },
  execute: async (
    client: LeadbayClient,
    params: SetQualificationMethodsParams,
    ctx?: ToolContext
  ) => {
    const hasSet = Array.isArray(params.questions);
    const hasAdd = Array.isArray(params.add) && params.add.length > 0;
    const hasRemove = Array.isArray(params.remove) && params.remove.length > 0;

    if (hasSet && (hasAdd || hasRemove)) {
      throw client.makeError(
        "QUALIFICATION_METHODS_BAD_ARGS",
        "`questions` (full replace) is mutually exclusive with add/remove",
        "Pass EITHER `questions` (the full new list) OR `add`/`remove`, not both.",
        "POST /organizations/{orgId}"
      );
    }
    if (!hasSet && !hasAdd && !hasRemove) {
      throw client.makeError(
        "QUALIFICATION_METHODS_NO_CHANGE",
        "nothing to change — pass `questions`, `add`, or `remove`",
        "Provide a full `questions` list, or `add`/`remove` entries.",
        "POST /organizations/{orgId}"
      );
    }

    const orgId = await client.resolveOrgId();

    // Read the current list (the endpoint is full-replace, so add/remove need it).
    const current = await client.request<AiAgentQuestionPayload[]>(
      "GET",
      `/organizations/${orgId}/ai_agent_questions`
    );
    const currentQs = (current ?? []).map((q) => q.question);

    const norm = (s: string) => s.trim();
    let next: string[];
    if (hasSet) {
      next = params.questions!.map(norm).filter((s) => s.length > 0);
    } else {
      next = [...currentQs];
      if (hasRemove) {
        const drop = new Set(params.remove!.map(norm));
        next = next.filter((q) => !drop.has(norm(q)));
      }
      if (hasAdd) {
        const seen = new Set(next.map(norm));
        for (const q of params.add!.map(norm)) {
          if (q.length > 0 && !seen.has(q)) {
            next.push(q);
            seen.add(q);
          }
        }
      }
    }

    // De-dupe while preserving order (the backend stores the list verbatim).
    const seen = new Set<string>();
    next = next.filter((q) => {
      const k = norm(q);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    // Backend cap (verified live): an org may hold at most MAX_QUESTIONS
    // qualification questions. Pre-check so the agent gets an actionable
    // message instead of a raw 400 from the org POST.
    const MAX_QUESTIONS = 5;
    if (next.length > MAX_QUESTIONS) {
      throw client.makeError(
        "QUALIFICATION_METHODS_LIMIT",
        `too many questions: ${next.length} (max ${MAX_QUESTIONS})`,
        `Leadbay allows at most ${MAX_QUESTIONS} qualification questions. Remove some first (pass fewer in \`questions\`, or use \`remove\`), then add.`,
        "POST /organizations/{orgId}"
      );
    }

    const previousCount = currentQs.length;
    const noChange =
      next.length === currentQs.length &&
      next.every((q, i) => norm(q) === norm(currentQs[i] ?? ""));

    if (noChange) {
      return withAgentMemoryMeta(
        client,
        {
          qualification_questions: currentQs.map((q) => ({ question: q })),
          count: currentQs.length,
          previous_count: previousCount,
          changed: false,
          region: client.region,
          hint: "No change — the resulting list is identical to the current one. Pass different `add`/`remove` entries, or call leadbay_get_qualification_methods to review the current questions.",
        },
        ctx
      );
    }

    // Dropping ANY existing question is destructive — require confirm. Gate on
    // the actual removed set, not on count: a remove+add (or a `set`) that swaps
    // one question for another keeps the count the same but still deletes a
    // scoring question, so a count-only check (next.length < previousCount)
    // would wrongly let it through without confirm.
    const removed = currentQs.filter((q) => !next.some((n) => norm(n) === norm(q)));
    if (removed.length > 0 && params.confirm !== true) {
      return withAgentMemoryMeta(
        client,
        {
          qualification_questions: currentQs.map((q) => ({ question: q })),
          count: currentQs.length,
          previous_count: previousCount,
          changed: false,
          region: client.region,
          hint: `Re-call with confirm:true to apply. This would remove ${removed.length} question(s): ${removed
            .map((q) => `"${q}"`)
            .join(", ")}. Removing a question changes how every lead is scored.`,
        },
        ctx
      );
    }

    // 204 No Content on success.
    await client.requestVoid("POST", `/organizations/${orgId}`, {
      ai_agent_lead_questions: next,
    });
    // The taste-profile cache holds the old questions — drop it so the next
    // read reflects the change.
    client.invalidateTasteProfile();

    return withAgentMemoryMeta(
      client,
      {
        qualification_questions: next.map((q) => ({ question: q })),
        count: next.length,
        previous_count: previousCount,
        changed: true,
        region: client.region,
      },
      ctx
    );
  },
};
