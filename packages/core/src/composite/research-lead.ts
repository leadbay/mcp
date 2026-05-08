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
  NotePayload,
  EpilogueResponsesPayload,
  ProspectingActionsPayload,
} from "../types.js";

interface ResearchLeadParams {
  leadId: string;
  lensId?: number;
  concise?: boolean;
  response_format?: "json" | "markdown";
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
// → firmographics → contacts → engagement.
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
  const enriched = Array.isArray(contacts.enriched)
    ? (contacts.enriched as Array<Record<string, unknown>>)
    : [];
  if (enriched.length > 0) {
    out.push(`\n## Contacts (enriched)`);
    for (const c of enriched.slice(0, 10)) {
      const fn = (c.first_name ?? "") as string;
      const ln = (c.last_name ?? "") as string;
      const title = c.job_title ?? "—";
      const email = c.email ?? "no email";
      out.push(`- **${(fn + " " + ln).trim() || "(unknown)"}** — ${title} · ${email}`);
    }
  }

  const engagement = (shape.engagement ?? {}) as Record<string, unknown>;
  const counts: Array<[string, unknown]> = [
    ["notes", engagement.notes_count],
    ["epilogue", engagement.epilogue_actions_count],
    ["prospecting", engagement.prospecting_actions_count],
  ];
  const activeCounts = counts.filter(([, v]) => typeof v === "number" && (v as number) > 0);
  if (activeCounts.length > 0 || engagement.liked || engagement.disliked) {
    out.push(`\n## Engagement`);
    if (engagement.liked) out.push(`- liked ✅`);
    if (engagement.disliked) out.push(`- disliked ❌`);
    for (const [k, v] of activeCounts) {
      out.push(`- ${k}: ${v}`);
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

export const researchLead: Tool<ResearchLeadParams> = {
  name: "leadbay_research_lead",
  annotations: {
    title: "Research a Leadbay lead in depth",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description:
    "Tell me everything decision-relevant about a single lead. Bundles the lens-scoped lead profile, the AI " +
    "qualification answers (the agent's knowledge-base food), the structured web-research signals (with hot " +
    "flags + sources), the enriched contacts, and the recent notes/epilogue/prospecting activity in one call. " +
    "Order is deliberate: qualification first, then signals, then firmographics, then contacts, then engagement. " +
    "Scoring has two layers: the basic `score` (firmographic, always present, already decent) and the AI " +
    "qualification layer (`ai_agent_lead_score` + per-question answers + web_fetch signals). The AI layer is " +
    "pre-populated for roughly the top 10 of each daily batch, and on-demand (via leadbay_bulk_qualify_leads) " +
    "for anything below that. Combine both layers when judging a lead. " +
    "When to use: when picking up a single lead from leadbay_pull_leads to decide whether to act on it. " +
    "When NOT to use: across many leads at once — that's leadbay_pull_leads' job. " +
    "(This composite supersedes the lower-level leadbay_get_lead_profile in agent flow; the granular tool stays " +
    "available for fine-grained access.)",
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
          "Lead profile basics: id, name, sector_id, size, location, website, description, short_description, plus tags/score/ai_agent_lead_score/social.",
      },
      contacts: {
        type: "object",
        description:
          "Two-tier contact set: `enriched` (paid contacts known on this lens for this lead) and `org` (org-level contacts visible beyond the lens).",
        properties: {
          enriched: { type: "array", items: { type: "object" } },
          org: { type: "array", items: { type: "object" } },
        },
      },
      engagement: {
        type: "object",
        description:
          "What humans/prior agent runs already did: liked/disliked flags, recommended_contact, counts (notes/epilogue/prospecting), and the most-recent items (recent_notes, recent_epilogue, recent_prospecting). Counts > 0 trigger conditional fan-out for the recent_* fields.",
        properties: {
          liked: { type: "boolean" },
          disliked: { type: "boolean" },
          new: { type: "boolean" },
          recommended_contact_title: { type: ["string", "null"] },
          recommended_contact: { type: ["object", "null"] },
          notes_count: { type: "number" },
          epilogue_actions_count: { type: "number" },
          prospecting_actions_count: { type: "number" },
          recent_notes: { type: "array", items: { type: "object" } },
          recent_epilogue: { type: "array", items: { type: "object" } },
          recent_prospecting: { type: "array", items: { type: "object" } },
        },
      },
      _meta: {
        type: "object",
        description:
          "Operator context: region (us/fr/custom), lens_id (the lens used for the lead-by-id fetch), web_fetch_in_progress (true if the backend is still hydrating signals).",
        properties: {
          region: { type: "string" },
          lens_id: { type: "number" },
          web_fetch_in_progress: { type: "boolean" },
        },
      },
    },
    required: ["qualification", "signals", "firmographics", "contacts", "engagement"],
  },
  execute: async (
    client: LeadbayClient,
    params: ResearchLeadParams,
    ctx?: ToolContext
  ) => {
    const lensId = params.lensId ?? (await client.resolveDefaultLens());
    const leadId = params.leadId;

    // Mark the lead as seen+clicked so Leadbay ages it out of the
    // Discover "new" view and the lens-refresh pipeline can deliver
    // fresh leads on next pull. Fire-and-forget: failure here must NOT
    // break research_lead.
    void client.request<void>("POST", "/interactions", [
      { type: "LEAD_SEEN",    leadId, lensId: String(lensId) },
      { type: "LEAD_CLICKED", leadId, lensId: String(lensId) },
    ]).catch(() => { /* swallow */ });

    // Fan-out the four sub-fetches in parallel. Soft-fail on the additive ones.
    const [profileR, qualR, contactsR, webFetchR] = await Promise.allSettled([
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
    ]);

    if (profileR.status === "rejected") {
      throw profileR.reason;
    }
    const lead = profileR.value;

    // Notes/epilogue/prospecting — only fetch if the lead summary suggests
    // there's anything to fetch. Saves 3 HTTP calls per lead in the common
    // case where nothing has been logged yet.
    const wantNotes = (lead.notes_count ?? 0) > 0;
    const wantEpilogue = (lead.epilogue_actions_count ?? 0) > 0;
    const wantProspecting = (lead.prospecting_actions_count ?? 0) > 0;
    const wantOrgContacts = (lead.org_contacts_count ?? 0) > 0;

    const engagementFetches = await Promise.allSettled([
      wantNotes
        ? client.request<NotePayload[]>("GET", `/leads/${leadId}/notes`)
        : Promise.resolve(null),
      wantEpilogue
        ? client.request<EpilogueResponsesPayload>(
            "GET",
            `/leads/${leadId}/epilogue_responses?count=10&page=0`
          )
        : Promise.resolve(null),
      wantProspecting
        ? client.request<ProspectingActionsPayload>(
            "GET",
            `/leads/${leadId}/prospecting_actions?count=10&page=0`
          )
        : Promise.resolve(null),
      wantOrgContacts
        ? client.request<ContactPayload[]>(
            "GET",
            `/leads/${leadId}/contacts?IncludeEnriched=true`
          )
        : Promise.resolve(null),
    ]);

    const [notesR, epilogueR, prospR, orgContactsR] = engagementFetches;
    const valOrNull = <T>(r: PromiseSettledResult<T | null>): T | null =>
      r.status === "fulfilled" ? (r.value ?? null) : null;

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
    const orgContacts = valOrNull(orgContactsR) ?? [];

    // Token-cap guard: when the cumulative response would exceed ~25k chars
    // (a rough proxy for ~6k tokens), set truncated:true and trim from the
    // least-load-bearing sections. Order: signals.entries first (biggest +
    // additive), then org_contacts (often empty), then recent_prospecting.
    // Never truncate qualification/firmographics/contacts — those are
    // load-bearing for "is this lead worth pursuing".
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
      // Compute the rough size of just signals; if signals alone push us
      // over budget, trim them aggressively (keep section labels +
      // first-2 entries each).
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

    return {
      // 1) qualification — single most important block for "is this lead worth pursuing"
      // boost_score is the canonical field (per AiAgentResponse.score). The valid
      // set is the discrete -10/0/10/20 boost (see types.ts comment), NOT a 0-10
      // average — the eval doc flagged the old `score_0_to_10` field name as
      // misleading. We now ship `boost_score` as canonical alongside an explicit
      // `score_scale` annotation; `score_0_to_10` is kept as a deprecated alias
      // for one minor version (0.6.x) and removed in 0.7.0. See MIGRATION.md.
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
      // 2) signals — knowledge-base food (may be trimmed when truncated:true)
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
        social_presence: lead.social_presence ?? null,
        social_urls: (lead as any).social_urls ?? null,
        registry_ids: (lead as any).registry_ids ?? null,
      },
      // 4) contacts (paid/enriched, plus org contacts if present)
      contacts: {
        enriched: paidContacts.map((c) => ({
          id: c.id,
          first_name: c.first_name,
          last_name: c.last_name,
          job_title: c.job_title,
          email: c.email,
          phone_number: c.phone_number,
          linkedin_page: c.linkedin_page,
          recommended: c.recommended,
          enrichment_done: c.enrichment?.done ?? false,
        })),
        org: orgContacts.map((c) => ({
          id: c.id,
          first_name: c.first_name,
          last_name: c.last_name,
          job_title: c.job_title,
          email: c.email,
        })),
      },
      // 5) engagement — what humans/prior agent runs already did
      engagement: {
        liked: lead.liked,
        disliked: lead.disliked,
        new: lead.new ?? false,
        recommended_contact_title: lead.recommended_contact_title ?? null,
        recommended_contact: lead.recommended_contact ?? null,
        notes_count: lead.notes_count ?? 0,
        epilogue_actions_count: lead.epilogue_actions_count ?? 0,
        prospecting_actions_count: lead.prospecting_actions_count ?? 0,
        recent_notes: valOrNull(notesR)?.slice(0, 3) ?? [],
        recent_epilogue: valOrNull(epilogueR)?.items?.slice(0, 3) ?? [],
        recent_prospecting:
          valOrNull(prospR)?.items?.slice(0, 5) ?? [],
      },
      _meta: {
        region: client.region,
        lens_id: lensId,
        web_fetch_in_progress:
          webFetchR.status === "fulfilled" ? webFetchR.value?.in_progress : false,
      },
    };
  },
};

// Wrapped execute that branches on params.response_format. Default behavior
// (response_format omitted or "json") is unchanged. When "markdown", the
// composite returns a MarkdownEnvelope: { __markdown_envelope, markdown,
// structured } — the MCP server special-cases this to emit markdown text
// + structuredContent.
const _innerExecute = researchLead.execute;
researchLead.execute = async (client, params, ctx) => {
  const result: any = await _innerExecute(client, params, ctx);
  if (params.response_format !== "markdown") return result;
  // result may be a LeadbayError envelope from upstream — pass through.
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
