import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";
import type { ContactPayload, PaidContactPayload } from "../types.js";
import { leadbay_get_contacts as GET_CONTACTS_DESCRIPTION } from "../tool-descriptions.generated.js";

interface GetContactsParams {
  leadId: string;
}

export const getContacts: Tool<GetContactsParams> = {
  name: "leadbay_get_contacts",
  annotations: {
    title: "Read enriched contacts",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: GET_CONTACTS_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      leadId: {
        type: "string",
        description: "Lead UUID (required)",
      },
    },
    required: ["leadId"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      contacts: {
        type: "array",
        description:
          "Merged org+paid contacts. Each: {id, first_name, last_name, email, phone_number, linkedin_page, job_title, recommended, enrichment, source:'org'|'paid'}. `source:'org'` entries additionally carry {pinned, pinned_by_ai}; `source:'paid'` entries do not, because a paid candidate cannot be pinned — passing its id to leadbay_pin_contact / leadbay_unpin_contact returns NOT_FOUND.",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            first_name: { type: ["string", "null"] },
            last_name: { type: ["string", "null"] },
            email: { type: ["string", "null"] },
            phone_number: { type: ["string", "null"] },
            linkedin_page: { type: ["string", "null"] },
            job_title: { type: ["string", "null"] },
            recommended: { type: "boolean" },
            pinned: {
              type: "boolean",
              description:
                "Someone flagged this person as the priority on the company. Present on source:'org' contacts only.",
            },
            pinned_by_ai: {
              type: "boolean",
              description:
                "The pin came from Leadbay's AI rather than a human. Present on source:'org' contacts only.",
            },
            source: { type: "string", enum: ["org", "paid"] },
            enrichment: {
              type: ["object", "null"],
              description:
                "Per-contact reveal record. Missing or null = the contact was NEVER requested (enrichable — not the same as done:false). Read `done` and `credits_used` TOGETHER: done:false = reservation in flight, poll and do not re-launch; done:true with credits_used:0 = the reveal SETTLED and found nothing, which is TERMINAL — do not re-attempt it on a later run; done:true with credits_used>0 = resolved, but the revealed channel lands on the source:'org' twin of this person, not on the source:'paid' record itself, so a null email here is not a failure. credits_used:0 on its own is NOT a verdict (an in-flight reservation reports 0 too), and an ABSENT credits_used means the cost is unknown, not zero.",
              properties: {
                done: {
                  type: "boolean",
                  description:
                    "False = reservation in flight. True = settled, either with a result (credits_used>0) or empty (credits_used:0). Per-contact, not per-channel.",
                },
                credits_used: {
                  type: "number",
                  description:
                    "Credits charged for this reveal. Only meaningful when done:true. An explicit 0 alongside done:true means the provider returned nothing. Optional — when absent the cost is unknown and terminal-empty must NOT be inferred.",
                },
                email_requested: { type: "boolean" },
                phone_requested: { type: "boolean" },
              },
            },
          },
          required: ["id", "source"],
        },
      },
      _fetch_errors: {
        type: "array",
        description:
          "Present only when one of the two contact endpoints failed. Each: {endpoint:'org'|'paid', code?, retry_after?}. A rejected endpoint contributes no contacts, so an empty `contacts` alongside this field is a fetch failure, NOT 'no contacts'.",
        items: { type: "object" },
      },
    },
    required: ["contacts"],
  },
  execute: async (client: LeadbayClient, params: GetContactsParams) => {
    const [orgResult, paidResult] = await Promise.allSettled([
      client.request<ContactPayload[]>(
        "GET",
        `/leads/${params.leadId}/contacts?IncludeEnriched=true`
      ),
      client.request<PaidContactPayload[]>(
        "GET",
        `/leads/${params.leadId}/enrich/contacts?IncludeEnriched=true`
      ),
    ]);

    const orgContacts =
      orgResult.status === "fulfilled" ? orgResult.value : [];
    const paidContacts =
      paidResult.status === "fulfilled" ? paidResult.value : [];

    // Additive failure signal (ignored by existing callers): allSettled turns a
    // rejected endpoint into [], so a transient 429 is otherwise indistinguishable
    // from "no contacts". Surface the rejections so status pollers can emit
    // partial_failures / honor retry_after instead of reporting a false empty.
    const fetchErrors: Array<{ endpoint: "org" | "paid"; code?: string; retry_after?: number }> = [];
    if (orgResult.status === "rejected") {
      const e: any = orgResult.reason;
      fetchErrors.push({ endpoint: "org", code: e?.code, retry_after: e?._meta?.retry_after });
    }
    if (paidResult.status === "rejected") {
      const e: any = paidResult.reason;
      fetchErrors.push({ endpoint: "paid", code: e?.code, retry_after: e?._meta?.retry_after });
    }

    return {
      ...(fetchErrors.length > 0 ? { _fetch_errors: fetchErrors } : {}),
      contacts: [
        ...orgContacts.map((c) => ({
          id: c.id,
          first_name: c.first_name,
          last_name: c.last_name,
          email: c.email,
          phone_number: c.phone_number,
          linkedin_page: c.linkedin_page,
          job_title: c.job_title,
          recommended: c.recommended,
          enrichment: c.enrichment,
          // Org contacts only — the backend's PaidContactPayload carries no
          // pin state, because a paid candidate cannot be pinned.
          pinned: c.pinned ?? false,
          pinned_by_ai: c.pinned_by_ai ?? false,
          source: "org" as const,
        })),
        ...paidContacts.map((c) => ({
          id: c.id,
          first_name: c.first_name,
          last_name: c.last_name,
          email: c.email,
          phone_number: c.phone_number,
          linkedin_page: c.linkedin_page,
          job_title: c.job_title,
          recommended: c.recommended,
          enrichment: c.enrichment,
          source: "paid" as const,
        })),
      ],
    };
  },
};
