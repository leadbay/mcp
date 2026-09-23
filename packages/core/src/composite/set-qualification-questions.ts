import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext, AiAgentQuestionPayload, IdealBuyerProfilePayload } from "../types.js";

import { leadbay_set_qualification_questions as SET_QUALIFICATION_QUESTIONS_DESCRIPTION } from "../tool-descriptions.generated.js";

// Backend cap (verified live): an org may hold at most this many qualification
// questions. Exported so the read tool reports free slots off the same number —
// a backend cap with two sources of truth drifts the first time it moves.
export const MAX_QUESTIONS = 5;

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
  // Negative criteria to append to the org's ideal buyer profile. Its own
  // write: exclusive with questions/add/remove.
  add_anti_patterns?: string[];
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

// The rescore prompt lists the ideal buyer profile's anti_patterns as "negative
// signals" and asks for an ibp score in [-20, 20] that feeds ai_agent_lead_score
// (backend AiRescoreLeads.buildRescorePrompt, RescoreCore). The endpoint is
// admin-only and a full replace, so this reads the profile and posts it back
// with the new entries appended. The backend then queues an intelligence
// regeneration and stops regenerating the profile itself (created_by is set).
async function addAntiPatterns(client: LeadbayClient, toAdd: string[]) {
  const me = await client.resolveMe();
  if (me.admin !== true) {
    return {
      error: true,
      code: "FORBIDDEN",
      message: "Changing the ideal buyer profile requires admin rights on the org",
      hint: "Nothing was saved. Tell the user an org admin has to add it, and show the current criteria with leadbay_get_qualification_questions.",
    };
  }
  const orgId = me.organization.id;
  const [questions, ibp] = await Promise.all([
    client.request<AiAgentQuestionPayload[]>("GET", `/organizations/${orgId}/ai_agent_questions`),
    client.request<IdealBuyerProfilePayload | null>("GET", `/organizations/${orgId}/ideal_buyer_profile`),
  ]);
  const qs = (questions ?? []).map((q) => ({ question: q.question }));
  const base = { qualification_questions: qs, count: qs.length, previous_count: qs.length, region: client.region };

  if (!ibp?.summary) {
    return {
      ...base,
      changed: false,
      hint: "This org has no ideal buyer profile yet, so there is nowhere to add a negative criterion. Use a qualification question or leadbay_refine_lead_targeting for this rule instead.",
    };
  }

  const key = (s: string) => s.trim().toLowerCase();
  const current = ibp.anti_patterns ?? [];
  const seen = new Set(current.map(key));
  const added: string[] = [];
  for (const a of toAdd.map((s) => s.trim())) {
    if (a.length > 0 && !seen.has(key(a))) {
      added.push(a);
      seen.add(key(a));
    }
  }
  if (added.length === 0) {
    return {
      ...base,
      anti_patterns: current,
      changed: false,
      hint: "No change: the ideal buyer profile already lists every criterion passed. leadbay_get_qualification_questions shows them.",
    };
  }

  const next = [...current, ...added];
  await client.requestVoid("POST", `/organizations/${orgId}/ideal_buyer_profile`, {
    summary: ibp.summary,
    key_characteristics: ibp.key_characteristics ?? [],
    anti_patterns: next,
  });
  client.invalidateTasteProfile();
  return {
    ...base,
    anti_patterns: next,
    anti_patterns_added: added,
    changed: true,
    hint: "Saved. Leads already scored keep their score until they are next qualified. Leadbay is regenerating its targeting from the profile in the background, and it no longer rewrites this profile by itself. leadbay_get_qualification_questions shows the updated profile.",
  };
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
    openWorldHint: false,
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
      add_anti_patterns: {
        type: "array",
        items: { type: "string" },
        description:
          "Negative criteria to append to the org's ideal buyer profile: kinds of company that are never the buyer (\"Consulting firms and IT services companies\", \"Franchise locations of national chains\"). Qualification reads them as negative signals when it scores a lead. Uses no question slot. Its own write: do not combine with questions/add/remove. Admin only. Read leadbay_get_qualification_questions first and skip anything an existing anti-pattern or question already says. In the user's language.",
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
      anti_patterns: {
        type: "array",
        items: { type: "string" },
        description: "The ideal buyer profile's negative criteria after an add_anti_patterns call.",
      },
      anti_patterns_added: {
        type: "array",
        items: { type: "string" },
        description: "The criteria this call wrote.",
      },
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
    const hasAntiPatterns = Array.isArray(params.add_anti_patterns) && params.add_anti_patterns.length > 0;

    if (hasAntiPatterns) {
      if (hasSet || hasAdd || hasRemove) {
        throw client.makeError(
          "QUALIFICATION_QUESTIONS_BAD_ARGS",
          "`add_anti_patterns` is its own write and cannot be combined with questions/add/remove",
          "Call once for the questions and once for the buyer profile.",
          "POST /organizations/{orgId}/ideal_buyer_profile"
        );
      }
      return addAntiPatterns(client, params.add_anti_patterns!);
    }

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
        "nothing to change — pass `questions`, `add`, `remove` or `add_anti_patterns`",
        "Provide a full `questions` list, `add`/`remove` entries, or `add_anti_patterns`.",
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

    // Only the text THIS call wrote. Warning about questions it carried over
    // untouched would nag the user into rewording questions that are working,
    // which is the opposite of what this tool's own guidance says to do.
    const written = hasSet ? next : (params.add ?? []).map(norm).filter((q) => next.includes(q));
    const warnings = formWarnings(written);

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
