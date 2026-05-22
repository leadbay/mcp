import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext } from "../types.js";
import { getLeadProfile } from "../tools/get-lead-profile.js";
import { getContacts } from "../tools/get-contacts.js";
import { enrichContacts } from "../tools/enrich-contacts.js";
import { withAgentMemoryMeta } from "../agent-memory/index.js";

import { leadbay_prepare_outreach as PREPARE_OUTREACH_DESCRIPTION } from "../tool-descriptions.generated.js";

interface PrepareOutreachParams {
  leadId: string;
  enrich?: boolean;
}

// B6 / B14: backend sometimes serializes a missing LinkedIn URL as the
// literal string "null". Coerce to real null so renderers never produce
// the four-character string.
function normalizeLinkedinPage(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed || trimmed.toLowerCase() === "null") return null;
  return trimmed;
}

export const prepareOutreach: Tool<PrepareOutreachParams> = {
  name: "leadbay_prepare_outreach",
  annotations: {
    title: "Prepare outreach package for a lead",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: PREPARE_OUTREACH_DESCRIPTION,
  optional: true,
  inputSchema: {
    type: "object",
    properties: {
      leadId: {
        type: "string",
        description: "Lead UUID (required)",
      },
      enrich: {
        type: "boolean",
        description:
          "If true and credits available, trigger enrichment on the recommended contact (default: false). Enrichment is async; re-call this tool (no enrich) after ~60s and check enrichment.complete to see if email/phone landed (B13: self-polling).",
      },
    },
    required: ["leadId"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      lead: {
        type: ["object", "null"],
        description:
          "Lead context for the brief. Expanded per B15: score, ai_summary, split_ai_summary, location, size, phone_numbers, website, description.",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          score: { type: ["number", "null"] },
          ai_agent_lead_score: { type: ["number", "null"] },
          ai_summary: { type: ["string", "null"] },
          split_ai_summary: { type: ["object", "null"] },
          location: { type: ["object", "null"] },
          size: { type: ["object", "null"] },
          phone_numbers: { type: ["array", "null"], items: { type: "string" } },
          website: { type: ["string", "null"] },
          description: { type: ["string", "null"] },
          short_description: { type: ["string", "null"] },
          social_presence: { type: ["object", "null"] },
          social_urls: { type: ["object", "null"] },
        },
      },
      recommended_contact: {
        type: ["object", "null"],
        description:
          "Best contact to outreach to. Always returned in the post-enrichment shape (B21) — first_name/last_name/contact_id/email/phone_number/linkedin_page/job_title — with nulls in fields that aren't yet enriched.",
        properties: {
          contact_id: { type: ["string", "null"] },
          first_name: { type: ["string", "null"] },
          last_name: { type: ["string", "null"] },
          job_title: { type: ["string", "null"] },
          email: { type: ["string", "null"] },
          phone_number: { type: ["string", "null"] },
          linkedin_page: { type: ["string", "null"] },
          is_org_contact: { type: ["boolean", "null"] },
        },
      },
      additional_contacts_count: {
        type: "number",
        description:
          "How many other contacts exist beyond the recommended one (renamed from other_contacts_count per B16; both shipped for one release).",
      },
      total_contacts_count: {
        type: "number",
        description: "Total contacts on this lead (recommended + others).",
      },
      other_contacts_count: {
        type: "number",
        description:
          "DEPRECATED: alias for additional_contacts_count. Will be removed in 0.10.0.",
      },
      enrichment: {
        type: "object",
        description:
          "Self-polling status (B13): triggered = whether this call kicked off enrichment; complete = whether the recommended contact now has email OR phone.",
        properties: {
          triggered: { type: "boolean" },
          complete: { type: "boolean" },
          error: { type: ["string", "null"] },
          hint: { type: ["string", "null"] },
        },
      },
      _meta: {
        type: "object",
        description: "Operator context: agent memory summary when enabled.",
      },
    },
    required: [
      "recommended_contact",
      "additional_contacts_count",
      "total_contacts_count",
      "enrichment",
    ],
  },
  execute: async (
    client: LeadbayClient,
    params: PrepareOutreachParams,
    ctx?: ToolContext
  ) => {
    const contactsResult = await getContacts.execute(
      client,
      { leadId: params.leadId },
      ctx
    );
    const contacts = contactsResult.contacts as Array<{
      id: string;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      phone_number: string | null;
      linkedin_page: string | null;
      job_title: string | null;
      recommended: boolean;
      source: "org" | "paid";
    }>;

    const recommended = contacts.find((c) => c.recommended) ?? contacts[0];

    let enrichmentTriggered = false;
    let enrichmentError: string | null = null;
    if (params.enrich && recommended) {
      try {
        await enrichContacts.execute(
          client,
          { leadId: params.leadId, contactId: recommended.id },
          ctx
        );
        enrichmentTriggered = true;
      } catch (e: any) {
        enrichmentError = e?.message ?? String(e);
      }
    }

    // Re-fetch contacts ONCE after triggering enrichment so the brief can
    // surface the freshest data without making the agent poll. The backend
    // is usually still working (~60s wall-clock) so this is best-effort —
    // when it lands, great; when it doesn't, the agent re-calls.
    let refreshed = contacts;
    if (enrichmentTriggered) {
      try {
        const again = await getContacts.execute(
          client,
          { leadId: params.leadId },
          ctx
        );
        refreshed = (again.contacts as typeof contacts) ?? contacts;
      } catch {
        // ignore — keep the original contact list
      }
    }
    const recommendedFresh =
      refreshed.find((c) => c.recommended) ?? recommended;

    // B12 + B15: pull the full lead profile so the brief carries
    // app_url / score / split_ai_summary / location / size etc. — no longer
    // a two-field stub.
    let leadBlock: Record<string, unknown> | null = null;
    try {
      const profile = await getLeadProfile.execute(
        client,
        { leadId: params.leadId },
        ctx
      );
      const p = profile.lead as Record<string, unknown>;
      leadBlock = {
        id: p.id ?? params.leadId,
        name: p.name ?? null,
        score: p.score ?? null,
        ai_agent_lead_score: p.ai_agent_lead_score ?? null,
        ai_summary: p.ai_summary ?? null,
        split_ai_summary: p.split_ai_summary ?? null,
        location: p.location ?? null,
        size: p.size ?? null,
        phone_numbers: p.phone_numbers ?? null,
        website: p.website ?? null,
        description: p.description ?? null,
        short_description: p.short_description ?? null,
        social_presence: p.social_presence ?? null,
        social_urls: p.social_urls ?? null,
      };
    } catch {
      // Profile fetch failed — still return the brief with a minimal lead block.
      leadBlock = {
        id: params.leadId,
        name: null,
        ai_summary: null,
      };
    }

    // B21: emit the post-enrichment field shape consistently — first_name /
    // last_name / contact_id / email / phone_number / linkedin_page / job_title
    // — with nulls in un-enriched fields. No more shape-flipping between
    // pre- and post-enrichment.
    const recommendedContact = recommendedFresh
      ? {
          contact_id: recommendedFresh.id ?? null,
          first_name: recommendedFresh.first_name,
          last_name: recommendedFresh.last_name,
          job_title: recommendedFresh.job_title,
          email: recommendedFresh.email,
          phone_number: recommendedFresh.phone_number,
          linkedin_page: normalizeLinkedinPage(recommendedFresh.linkedin_page),
          is_org_contact: recommendedFresh.source === "org",
        }
      : null;

    const total = refreshed.length;
    const additional = recommendedFresh ? Math.max(0, total - 1) : total;

    // B13: enrichment.complete — true when we have a usable channel beyond
    // LinkedIn. The agent can then re-call this tool to poll until complete.
    const enrichmentComplete = Boolean(
      recommendedContact &&
        (recommendedContact.email || recommendedContact.phone_number)
    );

    return withAgentMemoryMeta(client, {
      lead: leadBlock,
      recommended_contact: recommendedContact,
      additional_contacts_count: additional,
      total_contacts_count: total,
      // Deprecated alias kept for one release.
      other_contacts_count: additional,
      enrichment: {
        triggered: enrichmentTriggered,
        complete: enrichmentComplete,
        error: enrichmentError,
        hint:
          enrichmentTriggered && !enrichmentComplete
            ? "Enrichment running (~60s). Re-call leadbay_prepare_outreach with the same leadId (no enrich) and check enrichment.complete."
            : null,
      },
    }, ctx);
  },
};
