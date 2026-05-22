import type { LeadbayClient } from "../client.js";
import type {
  Tool,
  ToolContext,
  AiAgentResponse,
  LeadPayload,
  LeadWebFetchPayload,
  WebFetchSignalsSection,
  PaidContactPayload,
  ContactPayload,
  PaginatedActivities,
} from "../types.js";
import { withAgentMemoryMeta } from "../agent-memory/index.js";

import { leadbay_research_lead_by_id as RESEARCH_LEAD_BY_ID_DESCRIPTION } from "../tool-descriptions.generated.js";

// B6: the backend occasionally serializes a missing LinkedIn URL as the
// literal string "null" instead of JSON null. Coerce to real null so agents
// don't render `linkedin_page: "null"`.
function normalizeLinkedinPage(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed || trimmed.toLowerCase() === "null") return null;
  return trimmed;
}

export interface ResearchLeadByIdParams {
  leadId: string;
  lensId?: number;
  concise?: boolean;
  response_format?: "json" | "markdown";
  // Internal: passed by leadbay_research_lead_by_name_fuzzy so the resulting
  // _meta carries resolved_from/resolved_query/match_candidates. Not exposed
  // in the public inputSchema.
  _resolved?: {
    from: "companyName";
    query: string;
    candidates: Array<{ leadId: string; name: string; score: number | null }>;
  };
}

// Marker the MCP server special-cases when emitting tools/call responses.
// The composite returns this envelope when response_format='markdown'; the
// server emits the markdown as the text content and exposes the typed
// structuredContent via the structuredContent block. Other consumers
// (OpenClaw) currently treat the envelope's `structured` field as the
// payload (via toContent helper).
export interface MarkdownEnvelope {
  __markdown_envelope: true;
  markdown: string;
  structured: Record<string, unknown>;
}

// Pure render: structured research_lead shape → compact markdown.
// Order mirrors the JSON shape's mission importance: qualification → signals
// → firmographics → contacts → recent_activities.
export function renderResearchLeadMarkdown(
  shape: Record<string, unknown>
): string {
  const out: string[] = [];
  const firm = (shape.firmographics ?? {}) as Record<string, unknown>;
  const name = (firm.name ?? "(unnamed lead)") as string;
  out.push(`# ${name}`);
  if (firm.website) out.push(`Website: ${firm.website}`);
  if (firm.location) out.push(`Location: ${firm.location}`);
  if (typeof firm.score === "number" || firm.score === null) {
    const aiScore = firm.ai_agent_lead_score;
    out.push(
      `Score: ${firm.score ?? "—"}` +
        (aiScore != null ? ` · AI: ${aiScore}` : "")
    );
  }
  if (firm.short_description) out.push(`\n${firm.short_description}`);

  const qualification = Array.isArray(shape.qualification)
    ? (shape.qualification as Array<Record<string, unknown>>)
    : [];
  if (qualification.length > 0) {
    out.push(`\n## Qualification`);
    for (const q of qualification) {
      const score =
        q.boost_score != null ? `${q.boost_score}` : "—";
      const resp = q.response ? String(q.response).slice(0, 200) : "—";
      out.push(`- **${q.question}** (boost ${score}): ${resp}`);
    }
  }

  const signals = Array.isArray(shape.signals)
    ? (shape.signals as Array<Record<string, unknown>>)
    : [];
  if (signals.length > 0) {
    out.push(`\n## Signals`);
    for (const sec of signals) {
      const label = sec.section_label ?? "section";
      out.push(`### ${sec.section_emoji ?? ""} ${label}`.trim());
      const entries = Array.isArray(sec.entries)
        ? (sec.entries as Array<Record<string, unknown>>)
        : [];
      for (const e of entries.slice(0, 5)) {
        const text = e.text ?? e.summary ?? JSON.stringify(e).slice(0, 200);
        const hot = e.hot === true ? " 🔥" : "";
        out.push(`- ${text}${hot}`);
      }
      if (entries.length > 5) out.push(`- _${entries.length - 5} more …_`);
    }
  }

  const contacts = (shape.contacts ?? {}) as Record<string, unknown>;
  const reachable = Array.isArray(contacts.reachable)
    ? (contacts.reachable as Array<Record<string, unknown>>)
    : [];
  if (reachable.length > 0) {
    out.push(`\n## Contacts — reachable now`);
    for (const c of reachable.slice(0, 10)) {
      const fn = (c.first_name ?? "") as string;
      const ln = (c.last_name ?? "") as string;
      const title = c.job_title ?? "—";
      const channel = c.email ?? c.phone_number ?? "—";
      out.push(`- **${(fn + " " + ln).trim() || "(unknown)"}** — ${title} · ${channel}`);
    }
  }
  const candidates = Array.isArray(contacts.candidates)
    ? (contacts.candidates as Array<Record<string, unknown>>)
    : [];
  if (candidates.length > 0) {
    out.push(`\n## Contacts — candidates (need enrichment)`);
    for (const c of candidates.slice(0, 10)) {
      const fn = (c.first_name ?? "") as string;
      const ln = (c.last_name ?? "") as string;
      const title = c.job_title ?? "—";
      const li = c.linkedin_page ? `LinkedIn` : "no LinkedIn";
      out.push(`- **${(fn + " " + ln).trim() || "(unknown)"}** — ${title} · ${li}`);
    }
    if (candidates.length > 10) out.push(`- _${candidates.length - 10} more …_`);
  }

  const recentActivities = Array.isArray(shape.recent_activities)
    ? (shape.recent_activities as Array<Record<string, unknown>>)
    : [];
  const engagement = (shape.engagement ?? {}) as Record<string, unknown>;
  const counts: Array<[string, unknown]> = [
    ["notes", engagement.notes_count],
    ["epilogue", engagement.epilogue_actions_count],
    ["prospecting", engagement.prospecting_actions_count],
  ];
  const activeCounts = counts.filter(([, v]) => typeof v === "number" && (v as number) > 0);
  if (activeCounts.length > 0 || engagement.liked || engagement.disliked || recentActivities.length > 0) {
    out.push(`\n## Engagement`);
    if (engagement.liked) out.push(`- liked ✅`);
    if (engagement.disliked) out.push(`- disliked ❌`);
    for (const [k, v] of activeCounts) {
      out.push(`- ${k}: ${v}`);
    }
    if (recentActivities.length > 0) {
      out.push(`\n### Recent activity`);
      for (const a of recentActivities.slice(0, 10)) {
        const type = (a.type ?? "?") as string;
        const date = (a.date ?? "") as string;
        out.push(`- ${type} · ${date}`);
      }
    }
  }

  if (shape.truncated) {
    out.push(`\n_Truncated_: ${shape.truncation_hint ?? "response trimmed"}_`);
  }

  return out.join("\n");
}

// Map an emoji-prefixed section label like "🏢 company profile" to
// {section_emoji: "🏢", section_label: "company profile"}. If no emoji, label
// stays as-is. Stable section ordering: profile → signals → clues → others.
const SECTION_PRIORITY = ["profile", "signals", "clues"];

function splitEmojiSection(key: string): { emoji: string | null; label: string } {
  // Match a leading non-letter/non-digit character (typically emoji) followed by space.
  const m = key.match(/^([^\p{L}\p{N}\s]+)\s+(.+)$/u);
  if (m) return { emoji: m[1], label: m[2] };
  return { emoji: null, label: key };
}

function reshapeWebFetchContent(
  content: Record<string, unknown> | null
): WebFetchSignalsSection[] {
  if (!content) return [];
  const sections: WebFetchSignalsSection[] = [];
  for (const [key, val] of Object.entries(content)) {
    if (!Array.isArray(val)) continue;
    const { emoji, label } = splitEmojiSection(key);
    sections.push({
      section_label: label,
      section_emoji: emoji,
      entries: val as WebFetchSignalsSection["entries"],
    });
  }
  // Sort: known section labels first (in priority order), then alphabetical.
  sections.sort((a, b) => {
    const ai = SECTION_PRIORITY.findIndex((p) => a.section_label.toLowerCase().includes(p));
    const bi = SECTION_PRIORITY.findIndex((p) => b.section_label.toLowerCase().includes(p));
    const aN = ai < 0 ? SECTION_PRIORITY.length : ai;
    const bN = bi < 0 ? SECTION_PRIORITY.length : bi;
    if (aN !== bN) return aN - bN;
    return a.section_label.localeCompare(b.section_label);
  });
  return sections;
}

// Hashable contact summary used by hasReachableContact. A contact is
// "reachable" iff it has at least one of: non-empty email, non-empty
// phone_number. linkedin_page alone does NOT count as reachable — the agent
// can't message a LinkedIn URL without first opening LinkedIn manually.
function isReachable(c: { email?: string | null; phone_number?: string | null } | null | undefined): boolean {
  if (!c) return false;
  const email = typeof c.email === "string" ? c.email.trim() : "";
  const phone = typeof c.phone_number === "string" ? c.phone_number.trim() : "";
  return email.length > 0 || phone.length > 0;
}

export const researchLeadById: Tool<ResearchLeadByIdParams> = {
  name: "leadbay_research_lead_by_id",
  annotations: {
    title: "Research a Leadbay lead in depth (by UUID)",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: RESEARCH_LEAD_BY_ID_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      leadId: { type: "string", description: "Lead UUID (required)" },
      lensId: {
        type: "number",
        description:
          "Lens id (escape hatch — normally omit; auto-resolves to the active lens)",
      },
      concise: {
        type: "boolean",
        description:
          "If true, trim signals to hot=true items only (smaller payload). Default false.",
      },
      response_format: {
        type: "string",
        enum: ["json", "markdown"],
        description:
          "How the agent wants the result rendered. 'json' (default): the structured payload as text. 'markdown': a compact human-readable rendering (sections + bullets) — useful for chat-rendering clients (Cursor, Claude Desktop) where the user sees the response directly. structuredContent is emitted in both modes so capable clients still get typed access.",
      },
    },
    required: ["leadId"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      qualification: {
        type: "array",
        description:
          "Per-question AI qualification answers, ordered by mission importance. Each entry: question, boost_score (canonical -10|0|10|20), score_scale, response, computed_at. score_0_to_10 is a deprecated alias of boost_score (removed in 0.7.0).",
        items: {
          type: "object",
          properties: {
            question: { type: "string" },
            boost_score: { type: ["number", "null"] },
            score_scale: { type: "string" },
            score_0_to_10: { type: ["number", "null"] },
            response: { type: ["string", "null"] },
            computed_at: { type: ["string", "null"] },
          },
        },
      },
      signals: {
        type: "array",
        description:
          "Web-research signals reshaped into priority-ordered sections (profile → signals → clues → other). Each entry: section_label, section_emoji, entries[]. With concise:true, only hot=true entries kept. May be auto-trimmed when truncated:true (see below).",
        items: { type: "object" },
      },
      truncated: {
        type: "boolean",
        description:
          "True when the response was auto-trimmed to stay under the ~25k-char budget. Always false when concise:true is passed.",
      },
      truncation_hint: {
        type: ["string", "null"],
        description:
          "When truncated:true, names the specific argument that would reduce the payload (typically 'concise:true').",
      },
      firmographics: {
        type: "object",
        description:
          "Lead profile basics. The shapes here match the backend `LeadSimplified` schema verbatim — `size` is `{min,max,...}`, `location` is `{city,state,country,full,pos}`, `tags` are typed objects.",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          sector_id: { type: ["number", "string", "null"] },
          size: {
            type: ["object", "null"],
            description: "LeadSimplified.size — employee-count band.",
            properties: {
              low: { type: ["number", "null"] },
              high: { type: ["number", "null"] },
              min: { type: ["number", "null"] },
              max: { type: ["number", "null"] },
              label: { type: ["string", "null"] },
            },
          },
          location: {
            type: ["object", "null"],
            description: "LeadFullLocation — city/state/country/full/pos.",
            properties: {
              city: { type: ["string", "null"] },
              state: { type: ["string", "null"] },
              country: { type: ["string", "null"] },
              full: { type: ["string", "null"] },
              pos: {
                type: ["array", "null"],
                items: { type: "number" },
              },
            },
          },
          website: { type: ["string", "null"] },
          description: { type: ["string", "null"] },
          short_description: { type: ["string", "null"] },
          keywords: {
            type: "array",
            description:
              "Either bare strings (legacy) or {keyword,score} objects depending on the backend payload version.",
            items: {},
          },
          tags: {
            type: "array",
            description: "LeadTag[] — {id, display_name, tag, score}.",
            items: {
              type: "object",
              properties: {
                id: { type: ["number", "string", "null"] },
                display_name: { type: ["string", "null"] },
                tag: { type: "string" },
                score: { type: ["number", "null"] },
              },
            },
          },
          score: { type: ["number", "null"] },
          ai_agent_lead_score: { type: ["number", "null"] },
          ai_summary: { type: ["string", "null"] },
          split_ai_summary: {
            type: ["object", "null"],
            properties: {
              worth_pursuing: { type: ["string", "null"] },
              approach_angle: { type: ["string", "null"] },
              next_step: { type: ["string", "null"] },
            },
          },
          phone_numbers: {
            type: ["array", "null"],
            items: { type: "string" },
          },
          social_presence: {
            type: ["object", "null"],
            description:
              "LeadSocialPresence — 6 booleans per platform. Use `social_urls` for URLs.",
            properties: {
              crunchbase: { type: "boolean" },
              facebook: { type: "boolean" },
              instagram: { type: "boolean" },
              linkedin: { type: "boolean" },
              tiktok: { type: "boolean" },
              twitter: { type: "boolean" },
            },
          },
          social_urls: {
            type: ["object", "null"],
            description:
              "LeadSocialUrls — URL strings per platform; null when the company has no profile.",
            properties: {
              crunchbase: { type: ["string", "null"] },
              facebook: { type: ["string", "null"] },
              instagram: { type: ["string", "null"] },
              linkedin: { type: ["string", "null"] },
              tiktok: { type: ["string", "null"] },
              twitter: { type: ["string", "null"] },
            },
          },
          registry_ids: { type: ["object", "array", "null"] },
        },
        additionalProperties: false,
      },
      contacts: {
        type: "object",
        description:
          "Two-tier contact set, partitioned by reachability — agent-friendly framing of the backend's paid-vs-org split. `reachable`: contacts with an email or phone right now (org-directory entries that ship with channels, PLUS paid contacts whose enrichment has completed). The agent can message these without buying enrichment. `candidates`: paid-contact entries WITHOUT resolved channels yet — typically LinkedIn URL only, `enrichment_done: false`. The agent must call leadbay_enrich_titles (or leadbay_prepare_outreach with enrich:true) before these become messagable.",
        properties: {
          reachable: { type: "array", items: { type: "object" } },
          candidates: { type: "array", items: { type: "object" } },
        },
        additionalProperties: false,
      },
      recent_activities: {
        type: "array",
        description:
          "Unified activity timeline (top 20 most recent) from /leads/{id}/activities. Each entry: {type, date}. Replaces the per-category recent_notes/recent_epilogue/recent_prospecting arrays from the prior schema — counts stay on `engagement` as the cheap signal.",
        items: {
          type: "object",
          properties: {
            type: { type: "string" },
            date: { type: "string" },
          },
        },
      },
      web_insights_fetched_at: {
        type: ["string", "null"],
        description:
          "ISO timestamp of the latest /web_fetch run. Use as a staleness signal — if older than 30 days, offer to refresh.",
      },
      engagement: {
        type: "object",
        description:
          "What humans/prior agent runs already did: liked/disliked flags, recommended_contact, and counts (notes/epilogue/prospecting). Recent items live in `recent_activities` at the top level.",
        properties: {
          liked: { type: "boolean" },
          disliked: { type: "boolean" },
          new: { type: "boolean" },
          recommended_contact: { type: ["object", "null"] },
          notes_count: { type: "number" },
          epilogue_actions_count: { type: "number" },
          prospecting_actions_count: { type: "number" },
        },
        additionalProperties: false,
      },
      _meta: {
        type: "object",
        description:
          "Operator context: region (us/fr/custom), lens_id (the lens used for the lead-by-id fetch), web_fetch_in_progress (true if the backend is still hydrating signals), has_reachable_contact (true if at least one contact or recommended_contact has email or phone — drives NEXT STEPS routing between enrichment vs outreach). When the call was routed via leadbay_research_lead_by_name_fuzzy, also: resolved_from='companyName', resolved_query='<needle>', match_candidates=[{leadId,name,score}].",
        properties: {
          region: { type: "string" },
          lens_id: { type: "number" },
          web_fetch_in_progress: { type: "boolean" },
          has_reachable_contact: { type: "boolean" },
          resolved_from: { type: ["string", "null"] },
          resolved_query: { type: ["string", "null"] },
          match_candidates: {
            type: ["array", "null"],
            items: { type: "object" },
          },
          agent_memory: { type: "object" },
        },
        additionalProperties: false,
      },
    },
    required: [
      "qualification",
      "signals",
      "firmographics",
      "contacts",
      "engagement",
      "recent_activities",
    ],
  },
  execute: async (
    client: LeadbayClient,
    params: ResearchLeadByIdParams,
    _ctx?: ToolContext
  ) => {
    const lensId = params.lensId ?? (await client.resolveDefaultLens());
    const leadId = params.leadId;

    // Mark the lead as seen+clicked so Leadbay ages it out of the
    // Discover "new" view and the lens-refresh pipeline can deliver
    // fresh leads on next pull. Fire-and-forget: failure here must NOT
    // break research_lead_by_id.
    void client.request<void>("POST", "/interactions", [
      { type: "LEAD_SEEN",    leadId, lensId: String(lensId) },
      { type: "LEAD_CLICKED", leadId, lensId: String(lensId) },
    ]).catch(() => { /* swallow */ });

    // Fan-out the five sub-fetches in parallel. Soft-fail on the additive
    // ones (qualification, contacts, web_fetch, activities).
    const [profileR, qualR, contactsR, webFetchR, activitiesR, orgContactsR] = await Promise.allSettled([
      client.request<LeadPayload>("GET", `/lenses/${lensId}/leads/${leadId}`),
      client.request<AiAgentResponse[]>(
        "GET",
        `/leads/${leadId}/ai_agent_responses`
      ),
      client.request<PaidContactPayload[]>(
        "GET",
        `/leads/${leadId}/enrich/contacts?IncludeEnriched=true`
      ),
      client.request<LeadWebFetchPayload>("GET", `/leads/${leadId}/web_fetch`),
      client.request<PaginatedActivities>(
        "GET",
        `/leads/${leadId}/activities?count=20`
      ),
      client.request<ContactPayload[]>(
        "GET",
        `/leads/${leadId}/contacts?IncludeEnriched=true`
      ),
    ]);

    if (profileR.status === "rejected") {
      throw profileR.reason;
    }
    const lead = profileR.value;

    let signals = reshapeWebFetchContent(
      webFetchR.status === "fulfilled" ? webFetchR.value?.content ?? null : null
    );
    if (params.concise) {
      signals = signals
        .map((s) => ({
          ...s,
          entries: s.entries.filter((e) => e.hot === true),
        }))
        .filter((s) => s.entries.length > 0);
    }

    const paidContacts =
      contactsR.status === "fulfilled" ? contactsR.value : [];
    const orgContacts =
      orgContactsR.status === "fulfilled" ? orgContactsR.value : [];

    // Shape both sources identically, then partition by reachability rather
    // than by source endpoint. The backend exposes two endpoints
    // (`/leads/{id}/enrich/contacts` = paid-contact candidates, often
    // LinkedIn-only until enrichment completes; `/leads/{id}/contacts` =
    // org-directory entries that ship with channels) — but the agent only
    // cares about "can I message this person right now or do I need to
    // enrich first?". So we collapse both endpoints into one list, then
    // split by whether email/phone are populated. A paid contact whose
    // enrichment has completed flips from `candidates` → `reachable`.
    const shapePaid = (c: PaidContactPayload) => ({
      id: c.id,
      first_name: c.first_name,
      last_name: c.last_name,
      job_title: c.job_title,
      email: c.email,
      phone_number: c.phone_number,
      linkedin_page: normalizeLinkedinPage(c.linkedin_page),
      recommended: c.recommended,
      enrichment_done: c.enrichment?.done ?? false,
      source: "paid" as const,
    });
    const shapeOrg = (c: ContactPayload) => ({
      id: c.id,
      first_name: c.first_name,
      last_name: c.last_name,
      job_title: c.job_title,
      email: c.email,
      phone_number: c.phone_number ?? null,
      linkedin_page: normalizeLinkedinPage(c.linkedin_page ?? null),
      recommended: c.recommended,
      enrichment_done: true,
      source: "org" as const,
    });
    const allContacts: Array<ReturnType<typeof shapePaid> | ReturnType<typeof shapeOrg>> = [
      ...paidContacts.map(shapePaid),
      ...orgContacts.map(shapeOrg),
    ];
    const reachableContacts = allContacts.filter((c) => isReachable(c));
    const candidateContacts = allContacts.filter((c) => !isReachable(c));

    const recommendedContact = lead.recommended_contact
      ? {
          ...lead.recommended_contact,
          linkedin_page: normalizeLinkedinPage(
            (lead.recommended_contact as any).linkedin_page ?? null
          ),
        }
      : null;

    // has_reachable_contact: true when at least one contact (paid OR org)
    // or the recommended_contact has an email or phone right now. Drives
    // the NEXT STEPS routing between "enrich first" and "draft outreach
    // now".
    const hasReachableContact =
      reachableContacts.length > 0 ||
      isReachable(recommendedContact as any);

    // Token-cap guard: when the cumulative response would exceed ~25k chars
    // (a rough proxy for ~6k tokens), set truncated:true and trim from the
    // least-load-bearing sections. Order: signals.entries first (biggest +
    // additive). Never truncate qualification/firmographics/contacts —
    // those are load-bearing for "is this lead worth pursuing".
    const TRUNCATE_CHAR_BUDGET = 25_000;
    let truncated = false;
    let truncationHint: string | null = null;
    const probeSize = (obj: unknown) => {
      try {
        return JSON.stringify(obj).length;
      } catch {
        return 0;
      }
    };
    let signalsForReturn: typeof signals = signals;
    if (!params.concise) {
      const signalsSize = probeSize(signals);
      if (signalsSize > TRUNCATE_CHAR_BUDGET) {
        truncated = true;
        truncationHint =
          "Response truncated to fit context. Pass concise:true to filter to hot signals only.";
        signalsForReturn = signals.map((s) => ({
          ...s,
          entries: s.entries.slice(0, 2),
        }));
      }
    }

    const recentActivities =
      activitiesR.status === "fulfilled"
        ? activitiesR.value.items
            .slice(0, 20)
            .map((a) => ({ type: a.type, date: a.date }))
        : [];

    const webFetchFetchedAt =
      webFetchR.status === "fulfilled" ? webFetchR.value?.fetch_at ?? null : null;

    return withAgentMemoryMeta(client, {
      // 1) qualification
      qualification:
        qualR.status === "fulfilled"
          ? qualR.value.map((r) => ({
              question: r.question,
              boost_score: r.score,
              score_scale: "-10|0|10|20" as const,
              // Deprecated alias — same value as boost_score. Will be removed
              // in 0.7.0; consumers should switch to boost_score.
              score_0_to_10: r.score,
              response: r.response,
              computed_at: r.computed_at,
            }))
          : [],
      // 2) signals
      signals: signalsForReturn,
      truncated,
      truncation_hint: truncationHint,
      // 3) firmographics
      firmographics: {
        id: lead.id,
        name: lead.name,
        sector_id: (lead as any).sector_id ?? null,
        size: lead.size,
        location: lead.location,
        website: lead.website,
        description: lead.description,
        short_description: lead.short_description ?? null,
        keywords: lead.keywords ?? [],
        tags: lead.tags,
        score: lead.score,
        ai_agent_lead_score: lead.ai_agent_lead_score,
        ai_summary: lead.ai_summary ?? null,
        split_ai_summary: lead.split_ai_summary ?? null,
        phone_numbers: lead.phone_numbers ?? null,
        social_presence: lead.social_presence ?? null,
        social_urls: (lead as any).social_urls ?? null,
        registry_ids: (lead as any).registry_ids ?? null,
      },
      // 4) contacts — partitioned by reachability (not by source endpoint)
      contacts: {
        reachable: reachableContacts,
        candidates: candidateContacts,
      },
      // 5) unified recent activity timeline
      recent_activities: recentActivities,
      // 6) staleness signal (for "refresh research" NEXT STEPS row)
      web_insights_fetched_at: webFetchFetchedAt,
      // 7) engagement — counts + curation flags only; recent items live in
      // recent_activities[].
      engagement: {
        liked: lead.liked,
        disliked: lead.disliked,
        new: lead.new ?? false,
        recommended_contact: recommendedContact,
        notes_count: lead.notes_count ?? 0,
        epilogue_actions_count: lead.epilogue_actions_count ?? 0,
        prospecting_actions_count: lead.prospecting_actions_count ?? 0,
      },
      _meta: {
        region: client.region,
        lens_id: lensId,
        web_fetch_in_progress:
          webFetchR.status === "fulfilled" ? webFetchR.value?.in_progress : false,
        has_reachable_contact: hasReachableContact,
        resolved_from: params._resolved?.from ?? null,
        resolved_query: params._resolved?.query ?? null,
        match_candidates: params._resolved?.candidates ?? null,
      },
    }, _ctx);
  },
};

// Wrapped execute that branches on params.response_format. Default behavior
// (response_format omitted or "json") is unchanged. When "markdown", the
// composite returns a MarkdownEnvelope: { __markdown_envelope, markdown,
// structured } — the MCP server special-cases this to emit markdown text
// + structuredContent.
const _innerExecute = researchLeadById.execute;
researchLeadById.execute = async (client, params, ctx) => {
  const result: any = await _innerExecute(client, params, ctx);
  if (params.response_format !== "markdown") return result;
  if (result && typeof result === "object" && result.error === true) {
    return result;
  }
  const envelope: MarkdownEnvelope = {
    __markdown_envelope: true,
    markdown: renderResearchLeadMarkdown(result),
    structured: result,
  };
  return envelope as any;
};
