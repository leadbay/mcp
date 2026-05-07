import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext, NotePayload } from "../types.js";
import { EPILOGUE_LABEL_MAP } from "../tools/set-epilogue-status.js";

// Verification is REQUIRED on every call — the autoplan review (CEO + Eng + DX
// all flagged) determined that allowing the agent to self-report outreach
// without proof would poison the SDR pipeline. The user explicitly chose this
// option at the gate. Do NOT relax this without re-running the review.
type VerificationSource = "gmail_message_id" | "calendar_event_id" | "user_confirmed";

interface Verification {
  source: VerificationSource;
  ref: string;
}

interface ReportOutreachParams {
  lead_id?: string;
  lead_ids?: string[];
  note: string;
  epilogue_status?: string;
  verification: Verification;
  dry_run?: boolean;
}

const VALID_SOURCES = new Set<VerificationSource>([
  "gmail_message_id",
  "calendar_event_id",
  "user_confirmed",
]);

function formatNoteWithVerification(
  note: string,
  v: Verification
): string {
  return `${note}\n\n— logged by AI agent (verification: ${v.source}=${v.ref})`;
}

export const reportOutreach: Tool<ReportOutreachParams> = {
  name: "leadbay_report_outreach",
  annotations: {
    title: "Report outreach to Leadbay",
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  description:
    "Log an outreach action (email, call, message, meeting) on a lead so the human team using Leadbay sees the " +
    "progress in their UI. Writes a NOTE on the lead and (optionally) sets an EPILOGUE status (still chasing, " +
    "meeting booked, etc.). " +
    "VERIFICATION REQUIRED: every call must include verification={source: 'gmail_message_id'|'calendar_event_id'|'user_confirmed', ref: '<id-or-confirmation>'} " +
    "to prevent hallucinated outreach poisoning the pipeline. The verification is appended to the note body. " +
    "Bulk variant: pass lead_ids=[uuid,...] instead of lead_id (epilogue is bulk-native; notes fan out per-lead). " +
    "When to use: AFTER actually emailing/calling/meeting/messaging a contact, OR after a substantive decision " +
    "the user wants logged (skip, save, hand off). " +
    "When NOT to use: BEFORE doing the outreach (use dry_run:true to validate args first); without verification " +
    "(call will be rejected); from a flow where the user did not consent to having actions logged automatically.",
  optional: true,
  write: true,
  inputSchema: {
    type: "object",
    properties: {
      lead_id: { type: "string", description: "Single lead UUID (use lead_ids for bulk)" },
      lead_ids: {
        type: "array",
        items: { type: "string" },
        description: "Bulk: many lead UUIDs (epilogue applies to all; notes fan out)",
      },
      note: {
        type: "string",
        description:
          "1-2 sentence summary of what was done (e.g. 'Sent intro email to CTO citing Hornsea 3 contract')",
      },
      epilogue_status: {
        type: "string",
        description:
          "Optional: STILL_CHASING | COULD_NOT_REACH_STILL_TRYING | INTEREST_VALIDATED_OR_MEETING_PLANED | NOT_INTERESTED_LOST",
      },
      verification: {
        type: "object",
        description:
          "REQUIRED. Proof the action actually happened. source: gmail_message_id|calendar_event_id|user_confirmed. ref: the message id, event id, or the user's confirming text.",
        properties: {
          source: { type: "string" },
          ref: { type: "string" },
        },
        required: ["source", "ref"],
      },
      dry_run: {
        type: "boolean",
        description: "If true, return what WOULD be called without writing anything",
      },
    },
    required: ["note", "verification"],
  },
  execute: async (
    client: LeadbayClient,
    params: ReportOutreachParams,
    ctx?: ToolContext
  ) => {
    if (!params.verification || !params.verification.source || !params.verification.ref) {
      return {
        error: true,
        code: "VERIFICATION_REQUIRED",
        message:
          "report_outreach requires verification={source, ref} on every call. This prevents hallucinated outreach from poisoning the pipeline.",
        hint:
          "Provide verification.source as one of: gmail_message_id (the Gmail message id from sending), calendar_event_id (the event id from booking), or user_confirmed (set verification.ref to the user's literal confirmation in chat).",
      };
    }
    if (!VALID_SOURCES.has(params.verification.source)) {
      return {
        error: true,
        code: "BAD_VERIFICATION_SOURCE",
        message: `verification.source must be one of: gmail_message_id, calendar_event_id, user_confirmed (got: ${params.verification.source})`,
        hint:
          "Use 'user_confirmed' with verification.ref set to the user's literal text if you don't have a Gmail/Calendar id",
      };
    }
    if (!params.lead_id && (!params.lead_ids || params.lead_ids.length === 0)) {
      return {
        error: true,
        code: "BAD_INPUT",
        message: "Provide lead_id (single) or lead_ids (bulk)",
        hint: "lead_id for one lead; lead_ids: [uuid, ...] for many",
      };
    }

    const noteBody = formatNoteWithVerification(params.note, params.verification);

    let epilogueWire: string | null = null;
    if (params.epilogue_status) {
      const w = EPILOGUE_LABEL_MAP[params.epilogue_status];
      if (!w) {
        return {
          error: true,
          code: "BAD_INPUT",
          message: `Unknown epilogue_status: ${params.epilogue_status}`,
          hint: `Use one of: STILL_CHASING, COULD_NOT_REACH_STILL_TRYING, INTEREST_VALIDATED_OR_MEETING_PLANED, NOT_INTERESTED_LOST`,
        };
      }
      epilogueWire = w;
    }

    const targetLeads = params.lead_ids ?? [params.lead_id!];

    if (params.dry_run) {
      return {
        dry_run: true,
        would_write_notes: targetLeads.map((id) => ({
          method: "POST",
          path: `/leads/${id}/notes`,
          body: { note: noteBody },
        })),
        would_set_epilogue: epilogueWire
          ? {
              method: "POST",
              path: "/leads/epilogue",
              body: { lead_ids: targetLeads, status: epilogueWire },
            }
          : null,
      };
    }

    // Write notes (parallel fan-out, semaphore-capped). Per-lead success/failure
    // map for auditability.
    const noteResults = await Promise.all(
      targetLeads.map(async (leadId) => {
        try {
          const note = await client.request<NotePayload>(
            "POST",
            `/leads/${leadId}/notes`,
            { note: noteBody }
          );
          return { lead_id: leadId, ok: true, note_id: note.id };
        } catch (err: any) {
          return {
            lead_id: leadId,
            ok: false,
            error: err?.message ?? err?.code ?? String(err),
          };
        }
      })
    );

    let epilogueResult: { applied: boolean; error?: string } = { applied: false };
    if (epilogueWire) {
      try {
        await client.requestVoid("POST", "/leads/epilogue", {
          lead_ids: targetLeads,
          status: epilogueWire,
        });
        epilogueResult = { applied: true };
      } catch (err: any) {
        epilogueResult = {
          applied: false,
          error: err?.message ?? err?.code ?? String(err),
        };
        ctx?.logger?.warn?.(
          `report_outreach: epilogue failed: ${epilogueResult.error}`
        );
      }
    }

    return {
      notes: {
        succeeded: noteResults.filter((r) => r.ok).map((r) => ({ lead_id: r.lead_id, note_id: r.note_id })),
        failed: noteResults
          .filter((r) => !r.ok)
          .map((r) => ({ lead_id: r.lead_id, error: r.error })),
      },
      epilogue: {
        status: epilogueWire,
        ...epilogueResult,
      },
      verification: params.verification,
      _meta: { region: client.region },
    };
  },
};
