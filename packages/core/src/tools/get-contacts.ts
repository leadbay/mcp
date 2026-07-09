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
