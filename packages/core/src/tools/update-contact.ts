import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext } from "../types.js";
import { leadbay_update_contact as UPDATE_CONTACT_DESCRIPTION } from "../tool-descriptions.generated.js";

interface UpdateContactParams {
  // The contact's own UUID (the `id` on a contact object) — NOT the lead id.
  contact_id: string;
  // first_name + last_name are REQUIRED by the backend even on an edit — the
  // /update endpoint validates the full contact identity and rejects a
  // partial body ("invalid contact"). Pass the existing values for fields you
  // aren't changing.
  first_name: string;
  last_name: string;
  job_title?: string | null;
  linkedin_page?: string | null;
  email?: string | null;
  phone_number?: string | null;
}

interface UpdatedContact {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone_number: string | null;
  linkedin_page: string | null;
  job_title: string | null;
}

interface UpdateContactResult {
  updated: true;
  contact_id: string;
  contact: UpdatedContact;
  /** `merge` kept every field you did not send; `replace` rewrote the record. */
  mode: "merge" | "replace";
  /** Fields you did not send, which were left untouched. */
  preserved: string[];
  /** Fields you explicitly passed as null, which were erased. */
  cleared: string[];
}

/**
 * Edit an existing contact in place.
 *
 * Backend routes, both keyed by the contact's own id and taking the same
 * snake_case body: `/merge` keeps fields the caller omitted, `/update`
 * rewrites the record. We pick by intent — see `execute` (product#4046).
 * Either way the body MUST carry `first_name` + `last_name`: the endpoint
 * validates the identity (`OrgContact.isValid()` needs a name pair, an email,
 * a phone or a LinkedIn URL) and 400s ("invalid contact"). So callers pass
 * the contact's current first/last name even when only changing, say, the
 * title; read the current values via leadbay_research_lead_by_id first.
 */
export const updateContact: Tool<UpdateContactParams, UpdateContactResult> = {
  name: "leadbay_update_contact",
  description: UPDATE_CONTACT_DESCRIPTION,
  write: true,
  annotations: {
    title: "Update a contact",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  inputSchema: {
    type: "object",
    properties: {
      contact_id: {
        type: "string",
        description:
          "UUID of the contact to edit (the contact's own `id` — NOT the parent lead id).",
      },
      first_name: {
        type: "string",
        description:
          "Contact first name — REQUIRED even on an edit. Pass the current value if you're not changing it.",
      },
      last_name: {
        type: "string",
        description:
          "Contact last name — REQUIRED even on an edit. Pass the current value if you're not changing it.",
      },
      // Nullable so the agent can CLEAR a field (pass null) as well as set a
      // new value. execute forwards null verbatim; the backend accepts it.
      job_title: {
        type: ["string", "null"],
        description: "Contact job title. Omit it to leave it unchanged. Pass null to ERASE it — an erase rewrites the whole contact, so that call must also carry every other optional field, or it is refused.",
      },
      linkedin_page: {
        type: ["string", "null"],
        description: "Contact LinkedIn URL. Omit it to leave it unchanged. Pass null to ERASE it — an erase rewrites the whole contact, so that call must also carry every other optional field, or it is refused.",
      },
      email: {
        type: ["string", "null"],
        description: "Contact email. Omit it to leave it unchanged. Pass null to ERASE it — an erase rewrites the whole contact, so that call must also carry every other optional field, or it is refused.",
      },
      phone_number: {
        type: ["string", "null"],
        description: "Contact phone (free-form). Omit it to leave it unchanged. Pass null to ERASE it — an erase rewrites the whole contact, so that call must also carry every other optional field, or it is refused.",
      },
    },
    required: ["contact_id", "first_name", "last_name"],
    additionalProperties: false,
  },
  execute: async (
    client: LeadbayClient,
    params: UpdateContactParams,
    _ctx?: ToolContext,
  ): Promise<UpdateContactResult> => {
    // product#4046. The backend offers BOTH semantics on the same payload, and
    // we were unconditionally choosing the destructive one:
    //
    //   POST /contacts/{id}/update  → updateContact(forceUpdateIfNullOrEmpty=true)
    //                                 writes EVERY column, so a field absent
    //                                 from the body is erased.
    //   POST /contacts/{id}/merge   → updateContact(forceUpdateIfNullOrEmpty=false)
    //                                 skips null/empty fields, so anything the
    //                                 caller did not send keeps its value.
    //
    // (OrgContactRoutes.kt:110,152 → OrgContactsDaoImpl.kt:265-272.)
    //
    // So the safe reading of "leave it alone" already exists server-side and
    // costs nothing — no read-modify-write, no extra round-trip, no race. We
    // route by intent: an omitted field means keep it, and the ONLY way to
    // erase one is to say so with an explicit null.
    const OPTIONAL = ["job_title", "linkedin_page", "email", "phone_number"] as const;
    const asked = (f: (typeof OPTIONAL)[number]) => params[f] !== undefined;
    const clearing = OPTIONAL.filter((f) => params[f] === null);

    const body: Record<string, unknown> = {
      first_name: params.first_name,
      last_name: params.last_name,
    };
    for (const f of OPTIONAL) if (asked(f)) body[f] = params[f];

    if (clearing.length === 0) {
      // Nothing to erase — merge, and every field the caller left out survives.
      const contact = await client.request<UpdatedContact>(
        "POST",
        `/contacts/${params.contact_id}/merge`,
        body,
      );
      return {
        updated: true,
        contact_id: params.contact_id,
        contact,
        mode: "merge",
        preserved: OPTIONAL.filter((f) => !asked(f)),
        cleared: [],
      };
    }

    // A deliberate erase. /merge cannot express it — it skips nulls — so this
    // has to go through /update, which writes the whole record. That makes any
    // field the caller omitted collateral damage, so refuse rather than guess.
    // Costing the destructive path more effort than the safe one is the point.
    const missing = OPTIONAL.filter((f) => !asked(f));
    if (missing.length > 0) {
      throw client.makeError(
        "CONTACT_CLEAR_NEEDS_FULL_RECORD",
        `Clearing ${clearing.join(", ")} rewrites the whole contact, and ${missing.join(", ")} ${missing.length === 1 ? "was" : "were"} not supplied`,
        `Read the contact (leadbay_research_lead_by_id) and re-call with ALL of ${OPTIONAL.join(", ")} — current value to keep it, null to clear it. Omitting a field here would delete it.`,
        `POST /contacts/${params.contact_id}/update`,
      );
    }

    const contact = await client.request<UpdatedContact>(
      "POST",
      `/contacts/${params.contact_id}/update`,
      body,
    );
    return {
      updated: true,
      contact_id: params.contact_id,
      contact,
      mode: "replace",
      preserved: [],
      cleared: clearing,
    };
  },
};
