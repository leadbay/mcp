import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext, NotePayload } from "../types.js";
import { EPILOGUE_LABEL_MAP } from "../tools/set-epilogue-status.js";

import { leadbay_report_outreach as REPORT_OUTREACH_DESCRIPTION } from "../tool-descriptions.generated.js";
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
  contact_id?: string;
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

// A scheduled sync re-reads the same mailbox window every day, so the same
// Gmail message or calendar event reaches this tool more than once. A note
// that already ends with its verification line means it is logged: write
// nothing. A failed read counts as not logged, so a log is never lost.
async function alreadyLogged(
  client: LeadbayClient,
  notesPath: string,
  v: Verification
): Promise<boolean> {
  if (v.source === "user_confirmed") return false;
  const line = `(verification: ${v.source}=${v.ref})`;
  const notes = await client.request<NotePayload[]>("GET", notesPath).catch(() => null);
  return (Array.isArray(notes) ? notes : []).some(
    (n) => typeof n?.note === "string" && n.note.trimEnd().endsWith(line)
  );
}

export const reportOutreach: Tool<ReportOutreachParams> = {
  name: "leadbay_report_outreach",
  annotations: {
    title: "Report outreach to Leadbay",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  description: REPORT_OUTREACH_DESCRIPTION,
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
      contact_id: {
        type: "string",
        description:
          "Optional, with lead_id only: the org contact id of the person the outreach went to. The note and the epilogue status are then written on that person, and still show on the lead's Monitor row.",
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
        // Security-load-bearing: the verification field prevents the agent from
        // poisoning the SDR pipeline with hallucinated outreach. Extra keys here
        // would create an injection vector (e.g., agent passes
        // verification.bypass="true"). Hard-rejected per second-opinion #3.
        additionalProperties: false,
      },
      dry_run: {
        type: "boolean",
        description: "If true, return what WOULD be called without writing anything",
      },
    },
    required: ["note", "verification"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    description:
      "Either the dry_run shape (dry_run:true with would_write_notes / would_set_epilogue) OR the live result (notes:{succeeded,failed} + epilogue:{status,applied,error?} + verification + _meta). Schema declares both shapes; the dry_run discriminator picks which sub-shape applies.",
    properties: {
      // dry_run discriminator + dry_run subshape (from before iter 13)
      dry_run: { type: "boolean" },
      would_write_notes: {
        type: "array",
        description: "On dry_run: the per-lead POST shapes that WOULD be issued.",
        items: { type: "object" },
      },
      would_set_epilogue: {
        type: ["object", "null"],
        description: "On dry_run: the epilogue POST shape that WOULD be issued.",
      },
      // Live subshape — what execute() actually returns when dry_run is false.
      notes: {
        type: "object",
        description: "Per-lead note-write outcome (split into succeeded / failed sub-arrays).",
        properties: {
          succeeded: {
            type: "array",
            items: { type: "object" },
          },
          failed: {
            type: "array",
            items: { type: "object" },
          },
        },
      },
      epilogue: {
        type: "object",
        description:
          "Epilogue status outcome: status (the wire-format string written to /leads/epilogue, or null when not requested), applied (true/false), error (when applied=false).",
        properties: {
          status: { type: ["string", "null"] },
          applied: { type: "boolean" },
          error: { type: "string" },
        },
      },
      verification: {
        type: "object",
        description:
          "Effective verification used (after elicit override). Useful for the client UI to render \"logged with proof X\". When source=user_confirmed AND ctx.elicit was available, ref is the user's literal text typed into the client; otherwise it's the agent-supplied ref.",
        properties: {
          source: { type: "string" },
          ref: { type: "string" },
        },
      },
      contact_id: {
        type: "string",
        description: "Present when the note and the status were written on this person rather than on the lead.",
      },
      already_logged: {
        type: "array",
        items: { type: "string" },
        description:
          "Lead ids skipped because a note with this exact gmail_message_id or calendar_event_id is already there. Nothing was written for them.",
      },
      confirmed_via: {
        type: "string",
        description:
          "Audit trail of how verification was obtained: 'elicit' (user typed into client UI — anti-poisoning), 'agent_supplied' (legacy path; user_confirmed source with no elicit), 'non_user_confirmed' (gmail_message_id or calendar_event_id — agent can't fabricate these).",
      },
      _meta: {
        type: "object",
        description: "Operator context: region.",
        properties: { region: { type: "string" } },
      },
    },
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
    // Hard-reject extra keys on verification (security-load-bearing). The
    // MCP SDK does NOT enforce additionalProperties:false on nested input
    // schemas, so we validate at runtime per second-opinion #3 (iter 12).
    // Closes the injection vector "agent passes verification.bypass=true".
    const verificationKeys = Object.keys(params.verification);
    const extraKeys = verificationKeys.filter(
      (k) => k !== "source" && k !== "ref"
    );
    if (extraKeys.length > 0) {
      return {
        error: true,
        code: "VERIFICATION_EXTRA_KEYS",
        message: `verification accepts only {source, ref}; rejected extra key(s): ${extraKeys.join(", ")}`,
        hint:
          "Drop the extra key(s). Verification is security-sensitive — extra fields are not silently accepted.",
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
    if (params.contact_id && (!params.lead_id || params.lead_ids)) {
      return {
        error: true,
        code: "BAD_INPUT",
        message: "contact_id goes with a single lead_id, not lead_ids",
        hint: "Call once per person: lead_id plus that person's contact_id.",
      };
    }
    if (!params.lead_id && (!params.lead_ids || params.lead_ids.length === 0)) {
      return {
        error: true,
        code: "BAD_INPUT",
        message: "Provide lead_id (single) or lead_ids (bulk)",
        hint: "Set lead_id to one UUID for a single-lead call, or pass lead_ids: [uuid, ...] for a bulk call. Use leadbay_pull_leads to discover candidate IDs.",
      };
    }

    // iter-22: server-elicits-user-confirmation flow. When the agent passes
    // verification.source="user_confirmed" AND the client supports
    // elicitation, ask the user directly through the client UI rather than
    // trusting the agent-supplied ref. The agent never sees the elicit
    // prompt; the user types into the client; the response replaces
    // verification.ref. This closes the pipeline-poisoning vector where an
    // agent supplies its own "ref" prose and claims the user said it.
    //
    // Backwards-compat: legacy clients (no ctx.elicit) keep the existing
    // agent-supplied flow but the response carries confirmed_via:
    // "agent_supplied" so the SDR audit trail is honest.
    let confirmedVia: "elicit" | "agent_supplied" | "non_user_confirmed" =
      params.verification.source === "user_confirmed"
        ? "agent_supplied"
        : "non_user_confirmed";

    let effectiveVerification: Verification = params.verification;

    if (
      !params.dry_run &&
      params.verification.source === "user_confirmed" &&
      typeof ctx?.elicit === "function"
    ) {
      try {
        const targetIds = params.lead_ids ?? [params.lead_id!];
        const leadCount = targetIds.length;
        const elicitMsg =
          leadCount === 1
            ? `An AI agent wants to log outreach on lead ${targetIds[0]}: "${params.note}". The agent claims you confirmed this. Type your literal confirmation to proceed; cancel to reject.`
            : `An AI agent wants to log outreach on ${leadCount} leads: "${params.note}". The agent claims you confirmed this. Type your literal confirmation to proceed; cancel to reject.`;
        const result = await ctx.elicit({
          message: elicitMsg,
          requestedSchema: {
            type: "object",
            properties: {
              confirmation: {
                type: "string",
                title: "Your confirmation",
                description:
                  "Type a few words confirming the outreach actually happened. This text becomes the audit-trail entry.",
              },
            },
            required: ["confirmation"],
          },
        });
        if (result.action === "accept") {
          const userText = String(
            (result.content as any)?.confirmation ?? ""
          ).trim();
          if (userText.length > 0) {
            effectiveVerification = {
              source: "user_confirmed",
              ref: userText,
            };
            confirmedVia = "elicit";
          } else {
            // Empty/whitespace confirmation == decline.
            return {
              error: true,
              code: "OUTREACH_USER_CANCELLED",
              message:
                "User confirmation was empty; outreach not logged.",
              hint:
                "Re-call leadbay_report_outreach after the user types a non-empty confirmation, or use a gmail_message_id / calendar_event_id source instead.",
            };
          }
        } else {
          // action === "decline" || "cancel"
          return {
            error: true,
            code: "OUTREACH_USER_CANCELLED",
            message: `User ${result.action === "decline" ? "declined" : "cancelled"} the outreach confirmation; nothing was logged.`,
            hint:
              "Re-call leadbay_report_outreach with verification.source set to gmail_message_id or calendar_event_id when the user is unwilling to type a confirmation.",
          };
        }
      } catch (err: any) {
        // Client capability mismatch / transport drop / SDK unsupported —
        // fall through to agent-supplied flow with the existing ref. The
        // confirmedVia tag preserves audit honesty.
        ctx?.logger?.warn?.(
          `report_outreach: ctx.elicit failed (${err?.code ?? err?.message ?? err}) — falling back to agent-supplied verification`
        );
        // confirmedVia stays "agent_supplied".
      }
    }

    const noteBody = formatNoteWithVerification(params.note, effectiveVerification);

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

    const contactId = params.contact_id;
    // With contact_id the note and the status go on the person
    // (POST /contacts/{id}/notes, PATCH /contacts/{id}/prospecting-status).
    // Both still reach the lead: the note moves its last_prospecting_action_at
    // and the status sets its epilogue_status in Monitor (probed on prod FR
    // 2026-09-18, product#4174).
    const notesPath = (leadId: string) =>
      contactId ? `/contacts/${contactId}/notes` : `/leads/${leadId}/notes`;

    if (params.dry_run) {
      return {
        dry_run: true,
        would_write_notes: (params.lead_ids ?? [params.lead_id!]).map((id) => ({
          method: "POST",
          path: notesPath(id),
          body: { note: noteBody },
        })),
        would_set_epilogue: epilogueWire
          ? contactId
            ? {
                method: "PATCH",
                path: `/contacts/${contactId}/prospecting-status`,
                body: { status: epilogueWire },
              }
            : {
                method: "POST",
                path: "/leads/epilogue",
                body: { lead_ids: params.lead_ids ?? [params.lead_id!], status: epilogueWire },
              }
          : null,
      };
    }

    const requested = params.lead_ids ?? [params.lead_id!];
    const logged = await Promise.all(
      requested.map((id) => alreadyLogged(client, notesPath(id), effectiveVerification))
    );
    const alreadyLoggedLeads = requested.filter((_, i) => logged[i]);
    const targetLeads = requested.filter((_, i) => !logged[i]);

    // Write notes (parallel fan-out, semaphore-capped). Per-lead success/failure
    // map for auditability.
    const noteResults = await Promise.all(
      targetLeads.map(async (leadId) => {
        try {
          const note = await client.request<NotePayload>(
            "POST",
            notesPath(leadId),
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
    if (epilogueWire && targetLeads.length > 0) {
      try {
        if (contactId) {
          await client.requestVoid("PATCH", `/contacts/${contactId}/prospecting-status`, {
            status: epilogueWire,
          });
        } else {
          await client.requestVoid("POST", "/leads/epilogue", {
            lead_ids: targetLeads,
            status: epilogueWire,
          });
        }
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
      ...(contactId ? { contact_id: contactId } : {}),
      ...(alreadyLoggedLeads.length > 0 ? { already_logged: alreadyLoggedLeads } : {}),
      verification: effectiveVerification,
      // iter-22: audit-trail field. Tells the SDR team which path was taken
      // for this call:
      //   "elicit" = the user typed the confirmation directly via the
      //              client UI (anti-poisoning shape).
      //   "agent_supplied" = source was user_confirmed but ctx.elicit was
      //              unavailable / failed; agent's ref was accepted.
      //   "non_user_confirmed" = source was gmail_message_id or
      //              calendar_event_id (agent doesn't get to fabricate
      //              these — they're external ids).
      confirmed_via: confirmedVia,
      _meta: { region: client.region },
    };
  },
};
