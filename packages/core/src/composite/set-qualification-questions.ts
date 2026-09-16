import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext, AiAgentQuestionPayload } from "../types.js";

import { leadbay_set_qualification_questions as SET_QUALIFICATION_QUESTIONS_DESCRIPTION } from "../tool-descriptions.generated.js";

interface SetQualificationQuestionsParams {
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

// A question Leadbay's scorer can act on is ESTIMATIVE: the scorer reads public
// text it cannot verify, so a verifiable question ("Does the company ...?")
// scores nearly every lead as no. The backend's own generator enforces the same
// prefix (OpenAiAgentic, qualification_questions section). We do not reject a
// user-authored question — orgs hold working questions in the bare form — but
// we tell the caller which ones will score poorly so it can offer a fix
// (product#4139).
const ESTIMATIVE_MARKERS = [
  "is the company likely to",
  "l'entreprise est-elle susceptible",
  "l’entreprise est-elle susceptible",
];

function formWarnings(questions: string[]): string[] {
  const out: string[] = [];
  for (const q of questions) {
    const low = q.trim().toLowerCase();
    if (!ESTIMATIVE_MARKERS.some((m) => low.startsWith(m))) {
      out.push(
        `"${q}" is not in the estimative form. Leadbay scores from public text it cannot verify, so this will mark most leads no. Rewrite it to start "Is the company likely to ..." / "L'entreprise est-elle susceptible de ...".`
      );
    }
    if (q.length > 120) {
      out.push(`"${q.slice(0, 60)}…" is ${q.length} chars; keep a question under 120.`);
    }
  }
  return out;
}

// Modify the org's qualification questions (the AI-agent questions every lead is
// scored against). Wire: POST /organizations/{orgId} with
// {ai_agent_lead_questions: [string, ...]} → 204. The endpoint is a FULL
// REPLACE, so this tool reads the current list, applies the requested change
// (set / add / remove), and posts the whole resulting array. Shrinking the
// list requires confirm:true (removing a question changes how every lead is
// scored).
export const setQualificationQuestions: Tool<SetQualificationQuestionsParams> = {
  name: "leadbay_set_qualification_questions",
  annotations: {
    title: "Modify the org's qualification questions",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  description: SET_QUALIFICATION_QUESTIONS_DESCRIPTION,
  write: true,
  inputSchema: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        items: { type: "string", maxLength: 255 },
        description:
          "Full replacement list of qualification questions (replaces ALL current questions). Mutually exclusive with add/remove. A question Leadbay can score has ALL of: the estimative marker — it starts \"Is the company likely to \" in English or \"L'entreprise est-elle susceptible de/d' \" in French (never \"Does the company ...\" or a bare \"L'entreprise est-elle <X> ?\", which the scorer cannot verify and marks no); ONE dimension, not two joined by AND; something estimable from the company's public material, never its budget or its internal plans; and enough bite to split companies roughly 30/70 — a question nearly everyone answers yes to (\"has a website\") adds no signal, so say that and propose a sharper one rather than writing it. Max 120 chars, in the user's language. Never name a specific company in a question. Never re-send an existing question with reworded text that means the same thing — a reword is a delete plus an add, it re-scores every lead in the pipeline against the org's quota, and it surfaces exactly the same companies.",
      },
      add: {
        type: "array",
        items: { type: "string", maxLength: 255 },
        description:
          "Questions to append to the current list (deduped). Mutually exclusive with `questions`. A question Leadbay can score has ALL of: the estimative marker — it starts \"Is the company likely to \" in English or \"L'entreprise est-elle susceptible de/d' \" in French (never \"Does the company ...\" or a bare \"L'entreprise est-elle <X> ?\", which the scorer cannot verify and marks no); ONE dimension, not two joined by AND; something estimable from the company's public material, never its budget or its internal plans; and enough bite to split companies roughly 30/70 — a question nearly everyone answers yes to (\"has a website\") adds no signal, so say that and propose a sharper one rather than writing it. Max 120 chars, in the user's language. Never name a specific company in a question. Read leadbay_get_qualification_questions first: skip anything an existing question already tests, and anything the lens already filters by sector, headcount or territory.",
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
          "Required whenever the change DROPS ANY existing question — including a same-count swap or a `questions` replacement that omits a current question, not only when the list gets shorter (removing a question changes how every lead is scored). Without it, such a change is previewed and not applied. Pure additions never need confirm.",
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
      form_warnings: {
        type: "array",
        items: { type: "string" },
        description:
          "Present when a written question will score poorly — not in the estimative 'Is the company likely to ...' form, or over 120 chars. The change WAS applied; tell the user and offer the rewrite.",
      },
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
    params: SetQualificationQuestionsParams,
    ctx?: ToolContext
  ) => {
    const hasSet = Array.isArray(params.questions);
    const hasAdd = Array.isArray(params.add) && params.add.length > 0;
    const hasRemove = Array.isArray(params.remove) && params.remove.length > 0;

    if (hasSet && (hasAdd || hasRemove)) {
      throw client.makeError(
        "QUALIFICATION_QUESTIONS_BAD_ARGS",
        "`questions` (full replace) is mutually exclusive with add/remove",
        "Pass EITHER `questions` (the full new list) OR `add`/`remove`, not both.",
        "POST /organizations/{orgId}"
      );
    }
    if (!hasSet && !hasAdd && !hasRemove) {
      throw client.makeError(
        "QUALIFICATION_QUESTIONS_NO_CHANGE",
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
        "QUALIFICATION_QUESTIONS_LIMIT",
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
      return {
          qualification_questions: currentQs.map((q) => ({ question: q })),
          count: currentQs.length,
          previous_count: previousCount,
          changed: false,
          region: client.region,
          hint: "No change — the resulting list is identical to the current one. Pass different `add`/`remove` entries, or call leadbay_get_qualification_questions to review the current questions.",
        };
    }

    // Dropping ANY existing question is destructive — require confirm. Gate on
    // the actual removed set, not on count: a remove+add (or a `set`) that swaps
    // one question for another keeps the count the same but still deletes a
    // scoring question, so a count-only check (next.length < previousCount)
    // would wrongly let it through without confirm.
    const removed = currentQs.filter((q) => !next.some((n) => norm(n) === norm(q)));
    if (removed.length > 0 && params.confirm !== true) {
      return {
          qualification_questions: currentQs.map((q) => ({ question: q })),
          count: currentQs.length,
          previous_count: previousCount,
          changed: false,
          region: client.region,
          hint: `Re-call with confirm:true to apply. This would remove ${removed.length} question(s): ${removed
            .map((q) => `"${q}"`)
            .join(", ")}. Removing a question changes how every lead is scored.`,
        };
    }

    // 204 No Content on success.
    await client.requestVoid("POST", `/organizations/${orgId}`, {
      ai_agent_lead_questions: next,
    });
    // The taste-profile cache holds the old questions — drop it so the next
    // read reflects the change.
    client.invalidateTasteProfile();

    const warnings = formWarnings(next);

    return {
        qualification_questions: next.map((q) => ({ question: q })),
        count: next.length,
        previous_count: previousCount,
        changed: true,
        region: client.region,
        ...(warnings.length > 0 ? { form_warnings: warnings } : {}),
      };
  },
};
