// Per-kind one-sentence guidance for the agent. The agent reads
// `revise_hint` on each inbox entry and decides which of its prior outputs
// (in this conversation) the just-finished background work makes stale.
//
// Vocabulary discipline: always "notification" — never "task" / "pending
// action" / "async result". Backend ADR docs/adr/notifications.md is the
// canonical source.

import type { Notification, NotificationInboxEntry } from "../types.js";

export type InboxKind = NotificationInboxEntry["kind"];

const HINT_BULK_ENRICH =
  "Contact enrichment just finished. Revise any prior output that named these " +
  "leads' contacts (outreach drafts, contact lists, recommended-lead lists " +
  "with contact_count, NEXT STEPS asking the user to wait for emails / " +
  "phones). Re-fetch contacts via leadbay_get_contacts for the affected leads.";

const HINT_BULK_QUALIFY =
  "Lead qualification just finished. Revise any prior lead list / ranking / " +
  "outreach shortlist that depended on ai_agent_lead_score for these leads " +
  "— today's leads, top-of-inbox, followups maps, prepare-outreach " +
  "shortlists. Re-pull qualification answers via leadbay_research_lead_by_id " +
  "or re-rank via leadbay_pull_leads.";

const HINT_IMPORT =
  "CSV / CRM import just finished. Revise any prior output that referenced " +
  "'leads available' before the import landed — lead lists pulled from the " +
  "affected lens, 'what's new today', followup planning. Re-pull the " +
  "affected lens via leadbay_pull_leads / leadbay_pull_followups.";

const HINT_OTHER =
  "Background work just completed. If you referenced its subject in prior " +
  "output, re-fetch the affected data and revise.";

export function reviseHintFor(kind: InboxKind): string {
  switch (kind) {
    case "bulk_enrich":
      return HINT_BULK_ENRICH;
    case "bulk_qualify":
      return HINT_BULK_QUALIFY;
    case "import":
      return HINT_IMPORT;
    default:
      return HINT_OTHER;
  }
}

// Backend ADR §1 — bulk kind is inferred from anchor FK presence:
//   links[].type === "bulk_enrichment" → contact enrichment
//   file_import_id non-null            → CSV / CRM import
//   neither, bulk_progress set         → lead qualification
//   bulk_progress null                 → non-bulk notification ("other")
export function inferKind(n: Notification): InboxKind {
  if (n.links.some((l) => l.type === "bulk_enrichment")) return "bulk_enrich";
  if (n.file_import_id) return "import";
  if (n.bulk_progress) return "bulk_qualify";
  return "other";
}

export function anchorIdFor(n: Notification, kind: InboxKind): string | null {
  if (kind === "bulk_enrich") {
    const link = n.links.find((l) => l.type === "bulk_enrichment");
    return link ? String(link.id) : null;
  }
  if (kind === "import") return n.file_import_id;
  return null;
}

export function toInboxEntry(n: Notification): NotificationInboxEntry {
  const kind = inferKind(n);
  return {
    notification_id: n.id,
    kind,
    anchor_id: anchorIdFor(n, kind),
    title: n.title,
    bulk_progress: n.bulk_progress,
    completed_at: n.updated_at,
    revise_hint: reviseHintFor(kind),
  };
}
