/**
 * leadbay_campaign_call_sheet — cold-calling cheat sheet for a campaign.
 *
 * Joins:
 *   - GET /campaigns/{id}/contacts → per-contact phone/linkedin/email/role
 *     + recent_notes
 *   - GET /campaigns/{id}/leads    → split_ai_summary.next_step + location
 *     + score + progress
 *
 * Returns per-lead BLOCKS sorted by `score` desc, each block carrying the
 * lead's calling angle + every reachable contact. The cheat-sheet
 * RENDERING in the description renders each contact as a row with
 * `tel:` + linkedin links — modern chat hosts (Claude.ai, Cursor,
 * Claude Desktop) auto-linkify `tel:` URLs to open the native dialer on
 * macOS / iPhone-paired phones.
 *
 * Also surfaces an optional `map_locations` block ready to pass into
 * `places_map_display_v0` for a "route my call list geographically"
 * use case.
 */
import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";

import { leadbay_campaign_call_sheet as CALL_SHEET_DESCRIPTION } from "../tool-descriptions.generated.js";

interface CallSheetParams {
  campaign_id: string;
  count?: number;
  page?: number;
}

interface ContactRow {
  id: string;
  first_name?: string;
  last_name?: string;
  phone_number?: string | null;
  email?: string | null;
  linkedin_page?: string | null;
  job_title?: string | null;
  recommended?: boolean;
  pinned?: boolean;
  pinned_by_ai?: boolean;
}

interface ContactsResponseRow {
  lead_id: string;
  lead_name: string;
  progress?: {
    total_contacts?: number;
    in_progress?: number;
    declined?: number;
    headline?: string | null;
  };
  affiliation?: {
    own_campaigns?: Array<{ id: string; name: string }>;
    other_users_campaign_count?: number;
  };
  contacts?: Array<{
    contact: ContactRow;
    lead_id: string;
    recent_notes?: Array<{ note: string; created_at: string }>;
  }>;
}

interface LeadsResponseRow {
  lead: {
    id: string;
    name?: string;
    score?: number;
    ai_agent_lead_score?: number;
    website?: string;
    location?: {
      city?: string;
      state?: string;
      country?: string;
      pos?: [number, number];
      full?: string;
    };
    phone_numbers?: string[];
    short_description?: string;
    ai_summary?: string;
    split_ai_summary?: {
      worth_pursuing?: string;
      approach_angle?: string;
      next_step?: string;
    };
  };
  progress?: any;
  affiliation?: any;
}

interface ProgressLike {
  in_progress?: number;
  declined?: number;
  headline?: string | null;
}

function hasOutreachSignal(progress: ProgressLike | null | undefined): boolean {
  if (!progress) return false;
  return Boolean(
    progress.headline ||
      (progress.in_progress ?? 0) > 0 ||
      (progress.declined ?? 0) > 0,
  );
}

function normalizeLinkedin(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || t.toLowerCase() === "null") return null;
  return t;
}

function constructLinkedinFallback(
  first: string | undefined,
  last: string | undefined,
  company: string | undefined,
): string | null {
  if (!first || !last) return null;
  const cleanedCompany = (company ?? "")
    .replace(/\s+(Inc|LLC|Corp|GmbH|Ltd|Co|S\.A\.|S\.L\.|PLC|AG|SAS|SARL)\.?$/gi, "")
    .trim();
  const keywords = encodeURIComponent(
    [first, last, cleanedCompany].filter(Boolean).join(" "),
  );
  return `https://www.linkedin.com/search/results/people/?keywords=${keywords}`;
}

export const campaignCallSheet: Tool<CallSheetParams> = {
  name: "leadbay_campaign_call_sheet",
  annotations: {
    title: "Cold-calling cheat sheet for a campaign",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: CALL_SHEET_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      campaign_id: {
        type: "string",
        description: "Campaign UUID (from leadbay_create_campaign or leadbay_list_campaigns).",
      },
      count: {
        type: "number",
        description:
          "Leads per page for the underlying /campaigns/{id}/leads fetch (default 50). The contacts endpoint is not paginated; the composite always fetches all contacts and aligns them with the leads page.",
      },
      page: {
        type: "number",
        description: "0-indexed page (default 0).",
      },
    },
    required: ["campaign_id"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      campaign_id: { type: "string" },
      leads: {
        type: "array",
        description:
          "Per-lead call-ready blocks sorted by score desc. Each block: {lead_id, lead_name, score, ai_agent_lead_score, location, website, next_step, approach_angle, worth_pursuing, progress, affiliation, contacts: [{first_name, last_name, full_name, phone_number, phone_tel_url, email, mailto_url, linkedin_url, linkedin_url_source, job_title, recommended, pinned, recent_notes}]}.",
        items: { type: "object" },
      },
      map_locations: {
        type: "array",
        description:
          "Ready-to-pass entries for `places_map_display_v0` when the user wants a geographic call route: {name, address, latitude, longitude, notes}. One entry per lead that has a valid pos[]. Skip leads without coordinates.",
        items: { type: "object" },
      },
      summary: {
        type: "object",
        description:
          "Roll-up: total_leads, total_contacts, leads_with_phone, leads_with_email, leads_with_coords, leads_without_contacts, leads_already_contacted (headline/in_progress/declined outreach signal present).",
        properties: {
          total_leads: { type: "number" },
          total_contacts: { type: "number" },
          leads_with_phone: { type: "number" },
          leads_with_email: { type: "number" },
          leads_with_coords: { type: "number" },
          leads_without_contacts: { type: "number" },
          leads_already_contacted: { type: "number" },
        },
      },
      readiness: {
        type: "object",
        description:
          "Pre-computed booleans the orchestrator prompt uses to decide which session modes to OFFER. ready_for_calling (phone coverage ≥60%), ready_for_emailing (email coverage ≥60%), needs_enrichment (≥30% no-contact leads OR both phone+email coverage <40%), travel_friendly (≥5 geocoded leads AND coord coverage ≥60%).",
        properties: {
          ready_for_calling: { type: "boolean" },
          ready_for_emailing: { type: "boolean" },
          needs_enrichment: { type: "boolean" },
          travel_friendly: { type: "boolean" },
        },
      },
      pagination: {
        type: "object",
        properties: {
          page: { type: "number" },
          pages: { type: "number" },
          total: { type: "number" },
        },
      },
      _meta: {
        type: "object",
        properties: {
          region: { type: "string" },
          latency_ms: { type: ["number", "null"] },
        },
      },
    },
    required: ["campaign_id", "leads", "summary"],
  },
  execute: async (client: LeadbayClient, params: CallSheetParams) => {
    const count = params.count ?? 50;
    const page = params.page ?? 0;

    // Fan-out: contacts is the call-data source, leads is the
    // next-step/score/location source. Both are scoped to the campaign;
    // no cross-call dependency.
    const [contactsRes, leadsRes] = await Promise.all([
      client.request<ContactsResponseRow[]>(
        "GET",
        `/campaigns/${params.campaign_id}/contacts`,
      ),
      client.request<{
        items: LeadsResponseRow[];
        pagination: { page: number; pages: number; total: number };
      }>(
        "GET",
        `/campaigns/${params.campaign_id}/leads?count=${count}&page=${page}`,
      ),
    ]);

    const contactsByLeadId = new Map<string, ContactsResponseRow>();
    for (const row of contactsRes) {
      contactsByLeadId.set(row.lead_id, row);
    }

    // Build per-lead blocks aligned to the leads-page order so
    // pagination is meaningful. If a lead exists in /leads but not
    // /contacts (race: lead just added, contacts not yet rolled up),
    // we still emit the block with empty contacts[].
    const blocks = leadsRes.items.map((row) => {
      const lead = row.lead;
      const contactsRow = contactsByLeadId.get(lead.id);
      const contacts = (contactsRow?.contacts ?? []).map((c) => {
        const linkedin = normalizeLinkedin(c.contact.linkedin_page);
        const fallbackLi = linkedin
          ? null
          : constructLinkedinFallback(
              c.contact.first_name,
              c.contact.last_name,
              lead.name,
            );
        const phone = (c.contact.phone_number ?? "").trim() || null;
        // tel: URL — strip everything that isn't digits or leading + for
        // a canonical RFC-3966 form. Most chat hosts auto-linkify bare
        // phone strings; we provide both bare and an explicit tel: URL
        // so the agent can choose the rendering surface.
        const telUrl = phone
          ? `tel:${phone.replace(/[^\d+]/g, "")}`
          : null;
        const email = (c.contact.email ?? "").trim() || null;
        const mailtoUrl = email ? `mailto:${email}` : null;
        const fullName = [c.contact.first_name, c.contact.last_name]
          .filter(Boolean)
          .join(" ")
          .trim();
        return {
          id: c.contact.id,
          first_name: c.contact.first_name ?? null,
          last_name: c.contact.last_name ?? null,
          full_name: fullName || null,
          job_title: c.contact.job_title ?? null,
          phone_number: phone,
          phone_tel_url: telUrl,
          email,
          mailto_url: mailtoUrl,
          linkedin_url: linkedin ?? fallbackLi,
          linkedin_url_source: linkedin ? "leadbay" : fallbackLi ? "constructed" : null,
          recommended: c.contact.recommended ?? false,
          pinned: c.contact.pinned ?? false,
          pinned_by_ai: c.contact.pinned_by_ai ?? false,
          recent_notes: c.recent_notes ?? [],
        };
      });
      // Sort contacts: pinned-by-ai first, then recommended, then by
      // having a phone number (calling cheat sheet — phones come first).
      contacts.sort((a, b) => {
        const aRank =
          (a.pinned_by_ai ? 4 : 0) +
          (a.recommended ? 2 : 0) +
          (a.phone_number ? 1 : 0);
        const bRank =
          (b.pinned_by_ai ? 4 : 0) +
          (b.recommended ? 2 : 0) +
          (b.phone_number ? 1 : 0);
        return bRank - aRank;
      });

      const splitSummary = lead.split_ai_summary ?? {};
      // Lead-level "last action headline" — backend's most recent
      // InteractionType on this lead (CONTACTED / MEETING_BOOKED /
      // DECLINED / etc.). Per-contact last-action timestamps would need
      // a per-lead /leads/{id}/activities fan-out; we surface the lead
      // roll-up here and leave the deep timeline for
      // leadbay_get_lead_activities when the agent needs it.
      const headline = (row.progress as any)?.headline ?? null;
      return {
        lead_id: lead.id,
        lead_name: lead.name,
        score: lead.score ?? null,
        ai_agent_lead_score: lead.ai_agent_lead_score ?? null,
        website: lead.website ?? null,
        location: lead.location ?? null,
        company_phone_numbers: lead.phone_numbers ?? [],
        next_step: splitSummary.next_step ?? null,
        approach_angle: splitSummary.approach_angle ?? null,
        worth_pursuing: splitSummary.worth_pursuing ?? null,
        short_description: lead.short_description ?? null,
        last_action_headline: headline,
        progress: row.progress ?? null,
        affiliation: row.affiliation ?? null,
        contacts,
      };
    });

    // Sort lead blocks by ai_agent_lead_score desc (fall back to score
    // when ai score is null). This puts the most promising leads at the
    // top of the cheat sheet.
    blocks.sort((a, b) => {
      const aScore = a.ai_agent_lead_score ?? a.score ?? 0;
      const bScore = b.ai_agent_lead_score ?? b.score ?? 0;
      return bScore - aScore;
    });

    // Map-ready entries — only leads with a valid lat/lng. Notes string
    // follows the places_map_display_v0 carousel constraints (one short
    // sentence, bare phone/email auto-linkifies, no markdown).
    const mapLocations = blocks
      .filter((b) => {
        const pos = b.location?.pos;
        return Array.isArray(pos) && pos.length === 2 && pos.every((n) => typeof n === "number");
      })
      .map((b) => {
        const topContact = b.contacts[0];
        const angle = b.next_step ?? b.approach_angle ?? "Worth pursuing";
        let notes: string;
        if (topContact?.phone_number && topContact?.full_name) {
          notes = `★ ${angle} — call ${topContact.full_name}, ☎ ${topContact.phone_number}.`;
        } else if (topContact?.email && topContact?.full_name) {
          notes = `★ ${angle} — email ${topContact.full_name} at ${topContact.email}.`;
        } else if (topContact?.full_name) {
          notes = `★ ${angle} — reach ${topContact.full_name} (no channel enriched yet).`;
        } else {
          notes = `★ ${angle} — enrich titles to surface a contact.`;
        }
        return {
          name: b.lead_name,
          address: b.location?.full ??
            [b.location?.city, b.location?.state, b.location?.country].filter(Boolean).join(", "),
          latitude: b.location!.pos![0],
          longitude: b.location!.pos![1],
          notes: notes.slice(0, 280), // place-card notes truncate visibly past ~30 words
        };
      });

    const totalContacts = blocks.reduce((acc, b) => acc + b.contacts.length, 0);
    const leadsWithPhone = blocks.filter(
      (b) => b.contacts.some((c) => c.phone_number) || b.company_phone_numbers.length > 0,
    ).length;
    const leadsWithEmail = blocks.filter((b) =>
      b.contacts.some((c) => c.email),
    ).length;
    const leadsWithoutContacts = blocks.filter((b) => b.contacts.length === 0).length;
    const leadsAlreadyContacted = blocks.filter(
      (b) => hasOutreachSignal(b.progress),
    ).length;
    const leadsWithCoords = blocks.filter(
      (b) =>
        Array.isArray(b.location?.pos) &&
        b.location.pos.length === 2 &&
        b.location.pos.every((n: unknown) => typeof n === "number"),
    ).length;

    // Outreach-readiness assessment — a numeric signal the prompt can
    // turn into "which session mode should we offer". Roughly:
    //   - ready_for_calling: lots of phones, low gap
    //   - ready_for_emailing: lots of emails, low gap
    //   - needs_enrichment: many leads_without_contacts OR low
    //     phones/emails ratio
    //   - travel_friendly: enough geocoded leads for a map view
    const total = blocks.length;
    const phoneRatio = total > 0 ? leadsWithPhone / total : 0;
    const emailRatio = total > 0 ? leadsWithEmail / total : 0;
    const coordRatio = total > 0 ? leadsWithCoords / total : 0;
    const noContactRatio = total > 0 ? leadsWithoutContacts / total : 0;
    const readiness = {
      ready_for_calling: phoneRatio >= 0.6,
      ready_for_emailing: emailRatio >= 0.6,
      needs_enrichment: noContactRatio >= 0.3 || (phoneRatio < 0.4 && emailRatio < 0.4),
      travel_friendly: leadsWithCoords >= 5 && coordRatio >= 0.6,
    };

    return {
      campaign_id: params.campaign_id,
      leads: blocks,
      map_locations: mapLocations,
      summary: {
        total_leads: blocks.length,
        total_contacts: totalContacts,
        leads_with_phone: leadsWithPhone,
        leads_with_email: leadsWithEmail,
        leads_with_coords: leadsWithCoords,
        leads_without_contacts: leadsWithoutContacts,
        leads_already_contacted: leadsAlreadyContacted,
      },
      readiness,
      pagination: leadsRes.pagination,
      _meta: {
        region: client.region,
        latency_ms: client.lastMeta?.latency_ms ?? null,
      },
    };
  },
};
