import type { LeadbayClient } from "../client.js";
import type { NotePayload, Tool } from "../types.js";
import { leadbay_dislike_lead as DISLIKE_LEAD_DESCRIPTION } from "../tool-descriptions.generated.js";

interface DislikeLeadParams {
  lead_id: string;
  reason?: string;
}

// The dislike endpoint takes only `{source}`, so the reason lives in the one
// free-text store a lead has: its notes (product#4170).
const NOTE_MAX = 4095;
const noteText = (reason: string) => `Disliked: ${reason}`.slice(0, NOTE_MAX);

// A dislike changes no lens filter, question or targeting prompt. What the
// backend does derive from dislikes is UserLeadsDaoImpl.extractDislikedCriteria:
// sectors with >=2 dislikes and 0 likes among the lens's leads, cities with
// >=2, avoided in the first stage of the next RefreshLens / ExtendLens.
const TARGETING =
  "Unchanged. This dislike hides one lead from this user. Leadbay itself only avoids a sector on " +
  "the lens's next refresh after two of the lens's leads in it are disliked and none liked, and a " +
  "city after two. If the reason describes a kind of company rather than this one company (a " +
  "sector, a size, a territory, consultancies, subsidiaries of large groups), check whether the " +
  "org's criteria already reject it. An `ai_score` below 0 means qualification already scored " +
  "this lead against them: nothing to change. Otherwise call leadbay_get_qualification_questions: " +
  "if no anti-pattern or question already says it, propose adding the reason as a negative " +
  "criterion with leadbay_set_qualification_questions({add_anti_patterns}), and write it only on " +
  "the user's yes. In a run with no user, put the proposal in your report. Several dislikes with " +
  "one reason are one rule.";

// A negative ai_score is the case where the org's criteria already reject the
// lead, so the response says it outright rather than leaving the agent to apply
// the rule above.
const alreadyRejected = (score: number) =>
  `Unchanged, and nothing to change: qualification already scores this lead at ${score}, against ` +
  "the org's current criteria. The dislike and its reason are enough. Do not propose a setting " +
  "change for this reason.";

const targetingFor = (score: { ai_score?: number | null }) =>
  typeof score.ai_score === "number" && score.ai_score < 0 ? alreadyRejected(score.ai_score) : TARGETING;

function messageOf(e: unknown): string {
  if (e && typeof e === "object" && "message" in e) return String((e as Error).message);
  return String(e);
}

export const dislikeLead: Tool<DislikeLeadParams> = {
  name: "leadbay_dislike_lead",
  annotations: {
    title: "Dislike a lead",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  description: DISLIKE_LEAD_DESCRIPTION,
  optional: true,
  write: true,
  inputSchema: {
    type: "object",
    properties: {
      lead_id: {
        type: "string",
        description: "UUID of the lead to dislike.",
      },
      reason: {
        type: "string",
        description:
          "Why the lead is rejected, in the user's own words (\"société de conseil, hors ICP\", " +
          "\"unpaid invoice with them\"). In a run with no user, the criterion you applied. Saved " +
          "as a note on the lead that the whole team sees. Omit when no reason was given; never " +
          "invent one.",
      },
    },
    required: ["lead_id"],
    additionalProperties: false,
  },
  execute: async (client: LeadbayClient, params: DislikeLeadParams) => {
    await client.requestVoid("POST", `/leads/${params.lead_id}/dislike`);
    const result = { applied: true, lead_id: params.lead_id, action: "disliked" };

    const reason = params.reason?.trim();
    if (!reason) return { ...result, targeting: TARGETING };

    // The lead's qualification score says whether the org's criteria already
    // reject it. Best-effort: a failed read only drops the field.
    const aiScore = client
      .resolveDefaultLens()
      .then((lensId) =>
        client.request<{ ai_agent_lead_score?: number | null }>(
          "GET",
          `/lenses/${lensId}/leads/${params.lead_id}/with_or_without_lens`,
        ),
      )
      .then((lead): { ai_score?: number | null } => ({ ai_score: lead?.ai_agent_lead_score ?? null }))
      .catch((): { ai_score?: number | null } => ({}));

    // Read before writing so a retried call does not add the same note twice.
    const text = noteText(reason);
    try {
      const notes = await client.request<NotePayload[]>("GET", `/leads/${params.lead_id}/notes`);
      const existing = Array.isArray(notes) ? notes.find((n) => n.note === text) : undefined;
      const note =
        existing ??
        (await client.request<NotePayload>("POST", `/leads/${params.lead_id}/notes`, { note: text }));
      const score = await aiScore;
      return { ...result, reason_saved: true, note_id: note.id, ...score, targeting: targetingFor(score) };
    } catch (e) {
      const score = await aiScore;
      return {
        ...result,
        reason_saved: false,
        reason_error: messageOf(e),
        hint:
          "The dislike is recorded but the reason is not. Call leadbay_dislike_lead again with the " +
          "same lead_id and reason to save it; a note already saved is not written twice.",
        ...score,
        targeting: targetingFor(score),
      };
    }
  },
};
