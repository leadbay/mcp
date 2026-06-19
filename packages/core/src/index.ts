export {
  LeadbayClient,
  createClient,
  resolveRegion,
  formatLoginError,
  getMockJournal,
  clearMockJournal,
  REGIONS,
} from "./client.js";
export type { CreateClientConfig, TasteProfileResult } from "./client.js";
export * from "./types.js";
export * from "./agent-memory/index.js";
export { COMPOSITE_FILE_TOOL_NAMES } from "./composite/_composite-file-names.js";
export * from "./notifications/index.js";

// ─── Granular tools — 1:1 with Leadbay API endpoints ─────────────────────

// Existing (pre-autoplan)
import { login } from "./tools/login.js";
import { listLenses } from "./tools/list-lenses.js";
import { discoverLeads } from "./tools/discover-leads.js";
import { getLeadProfile } from "./tools/get-lead-profile.js";
import { getContacts } from "./tools/get-contacts.js";
import { getQuota } from "./tools/get-quota.js";
import { getTasteProfile } from "./tools/get-taste-profile.js";
import { qualifyLead } from "./tools/qualify-lead.js";
import { enrichContacts } from "./tools/enrich-contacts.js";
import { addNote } from "./tools/add-note.js";
import { getLeadActivities } from "./tools/get-lead-activities.js";

// New read tools (autoplan §E3)
import { getLensFilter } from "./tools/get-lens-filter.js";
import { getLensScoring } from "./tools/get-lens-scoring.js";
import { listSectors } from "./tools/list-sectors.js";
import { listLocations } from "./tools/list-locations.js";
import { getUserPrompt } from "./tools/get-user-prompt.js";
import { getClarification } from "./tools/get-clarification.js";
import { getLeadNotes } from "./tools/get-lead-notes.js";
import { getEpilogueResponses } from "./tools/get-epilogue-responses.js";
import { getProspectingActions } from "./tools/get-prospecting-actions.js";
import { getWebFetch } from "./tools/get-web-fetch.js";
import { getSelectionIds } from "./tools/get-selection-ids.js";
import { getEnrichmentJobTitles } from "./tools/get-enrichment-job-titles.js";
import { listMappableFields } from "./tools/list-mappable-fields.js";
import { createTopupLink } from "./tools/create-topup-link.js";
import { openBillingPortal } from "./tools/open-billing-portal.js";
import { agentMemoryRecall } from "./tools/agent-memory-recall.js";
import { agentMemoryCapture } from "./tools/agent-memory-capture.js";
import { agentMemoryReview } from "./tools/agent-memory-review.js";
import { acknowledgeNotification } from "./tools/acknowledge-notification.js";

// New write tools (autoplan §E5) — gated behind LEADBAY_MCP_WRITE=1 in MCP
import { selectLeads } from "./tools/select-leads.js";
import { deselectLeads } from "./tools/deselect-leads.js";
import { clearSelection } from "./tools/clear-selection.js";
import { setActiveLens } from "./tools/set-active-lens.js";
import { createLens } from "./tools/create-lens.js";
import { updateLens } from "./tools/update-lens.js";
import { updateLensFilter } from "./tools/update-lens-filter.js";
import { createLensDraft } from "./tools/create-lens-draft.js";
import { promoteLens } from "./tools/promote-lens.js";
import { setUserPrompt } from "./tools/set-user-prompt.js";
import { clearUserPrompt } from "./tools/clear-user-prompt.js";
import { pickClarification } from "./tools/pick-clarification.js";
import { dismissClarification } from "./tools/dismiss-clarification.js";
import { setEpilogueStatus } from "./tools/set-epilogue-status.js";
import { removeEpilogue } from "./tools/remove-epilogue.js";
import { setPushback } from "./tools/set-pushback.js";
import { removePushback } from "./tools/remove-pushback.js";
import { previewBulkEnrichment } from "./tools/preview-bulk-enrichment.js";
import { launchBulkEnrichment } from "./tools/launch-bulk-enrichment.js";
import { createCustomField } from "./tools/create-custom-field.js";
import { updateCustomField } from "./tools/update-custom-field.js";
import { deleteCustomField } from "./tools/delete-custom-field.js";
import { likeLead } from "./tools/like-lead.js";
import { dislikeLead } from "./tools/dislike-lead.js";
// Contact management — single-call relay tools (granular-shaped); registered
// in compositeWriteTools below so they stay on the default surface.
import { addContact } from "./tools/add-contact.js";
import { removeContact } from "./tools/remove-contact.js";
import { pinContact } from "./tools/pin-contact.js";
import { unpinContact } from "./tools/unpin-contact.js";
import { updateContact } from "./tools/update-contact.js";

// ─── Composite workflow tools — agent-facing surface ─────────────────────

// Existing
import { prepareOutreach } from "./composite/prepare-outreach.js";

// New (autoplan §E4 reads + §E6 writes)
import { pullLeads } from "./composite/pull-leads.js";
import { pullFollowups } from "./composite/pull-followups.js";
import { followupsMap } from "./composite/followups-map.js";
import { tourPlan } from "./composite/tour-plan.js";
import { createCampaign } from "./composite/create-campaign.js";
import { addLeadsToCampaign } from "./composite/add-leads-to-campaign.js";
import { removeLeadsFromCampaign } from "./composite/remove-leads-from-campaign.js";
import { listCampaigns } from "./composite/list-campaigns.js";
import { campaignProgression } from "./composite/campaign-progression.js";
import { campaignCallSheet } from "./composite/campaign-call-sheet.js";
import { researchLeadById } from "./composite/research-lead-by-id.js";
import { researchLeadByNameFuzzy } from "./composite/research-lead-by-name-fuzzy.js";
import { getQualificationMethods } from "./composite/get-qualification-methods.js";
import { getLeadCustomFields } from "./composite/get-lead-custom-fields.js";
import { accountHistory } from "./composite/account-history.js";
import { scanPortfolioSignals } from "./composite/scan-portfolio-signals.js";
import { recallOrderedTitles } from "./composite/recall-ordered-titles.js";
import { accountStatus } from "./composite/account-status.js";
import { bulkQualifyLeads } from "./composite/bulk-qualify-leads.js";
import { resolveImportRows } from "./composite/resolve-import-rows.js";
import { importLeads } from "./composite/import-leads.js";
import { importAndQualify } from "./composite/import-and-qualify.js";
import { importStatus } from "./composite/import-status.js";
import { qualifyStatus } from "./composite/qualify-status.js";
import { enrichTitles } from "./composite/enrich-titles.js";
import { bulkEnrichStatus } from "./composite/bulk-enrich-status.js";
import { adjustAudience } from "./composite/adjust-audience.js";
import { refinePrompt } from "./composite/refine-prompt.js";
import { seedCandidates } from "./composite/seed-candidates.js";
import { extendLens } from "./composite/extend-lens.js";
import { myLenses } from "./composite/my-lenses.js";
import { newLens } from "./composite/new-lens.js";
import { answerClarification } from "./composite/answer-clarification.js";
import { reportOutreach } from "./composite/report-outreach.js";
import { reportFriction } from "./composite/report-friction.js";
import { sendFeedback } from "./tools/send-feedback.js";

import type { Tool } from "./types.js";

// Bulk tracking — composite support + public types for MCP/OpenClaw wiring.
export {
  LocalBulkStore,
  InMemoryBulkStore,
  createDefaultBulkStore,
  isValidBulkId,
} from "./jobs/bulk-store.js";
export type {
  BulkTracker,
  BulkRecord,
  FindOrCreatePendingArgs,
  FindOrCreatePendingImportArgs,
  LocalBulkStoreOpts,
  CreateDefaultBulkStoreOpts,
} from "./jobs/bulk-store.js";

// Re-export individual tools for granular consumers
export {
  // existing granular
  login, listLenses, discoverLeads, getLeadProfile, getContacts, getQuota,
  getTasteProfile, qualifyLead, enrichContacts, addNote, getLeadActivities,
  // new granular reads
  getLensFilter, getLensScoring, listSectors, listLocations, getUserPrompt, getClarification,
  getLeadNotes, getEpilogueResponses, getProspectingActions, getWebFetch,
  getSelectionIds, getEnrichmentJobTitles,
  listMappableFields,
  createTopupLink, openBillingPortal,
  agentMemoryRecall, agentMemoryCapture, agentMemoryReview,
  acknowledgeNotification,
  // new granular writes
  selectLeads, deselectLeads, clearSelection, setActiveLens, createLens,
  updateLens, updateLensFilter, createLensDraft, promoteLens, setUserPrompt,
  clearUserPrompt, pickClarification, dismissClarification, setEpilogueStatus,
  removeEpilogue, setPushback, removePushback, previewBulkEnrichment,
  launchBulkEnrichment, likeLead, dislikeLead,
  createCustomField, updateCustomField, deleteCustomField,
  // existing composite
  prepareOutreach,
  // new composite reads
  pullLeads, pullFollowups, followupsMap, tourPlan, listCampaigns,
  campaignProgression, campaignCallSheet, researchLeadById, researchLeadByNameFuzzy,
  getQualificationMethods, getLeadCustomFields,
  accountHistory,
  recallOrderedTitles, accountStatus, scanPortfolioSignals,
  bulkEnrichStatus, qualifyStatus, importStatus, resolveImportRows,
  // new composite writes
  bulkQualifyLeads, enrichTitles, adjustAudience, refinePrompt,
  answerClarification, reportOutreach, reportFriction, sendFeedback, importLeads, importAndQualify,
  createCampaign, addLeadsToCampaign, removeLeadsFromCampaign,
  seedCandidates, extendLens,
};

// ─── Tool catalogues ─────────────────────────────────────────────────────

// Agent memory tools are always exposed: local-file recall/capture/review is
// part of the agent protocol, not an advanced backend API surface.
export const agentMemoryTools: Tool[] = [
  agentMemoryRecall,
  agentMemoryCapture,
  agentMemoryReview,
];

// Granular reads (advanced — gated by LEADBAY_MCP_ADVANCED=1 in MCP).
export const granularReadTools: Tool[] = [
  listLenses,
  discoverLeads,
  getLeadProfile,
  getLeadActivities,
  getTasteProfile,
  getContacts,
  getQuota,
  getLensFilter,
  getLensScoring,
  listLocations,
  getUserPrompt,
  getClarification,
  getLeadNotes,
  getEpilogueResponses,
  getProspectingActions,
  getWebFetch,
  getSelectionIds,
  getEnrichmentJobTitles,
  listMappableFields,
  createTopupLink,
  openBillingPortal,
];

// Granular writes (advanced + write — gated by both LEADBAY_MCP_ADVANCED=1
// AND LEADBAY_MCP_WRITE=1 in MCP).
export const granularWriteTools: Tool[] = [
  qualifyLead,
  enrichContacts,
  addNote,
  selectLeads,
  deselectLeads,
  clearSelection,
  setActiveLens,
  createLens,
  updateLens,
  updateLensFilter,
  createLensDraft,
  promoteLens,
  setUserPrompt,
  clearUserPrompt,
  pickClarification,
  dismissClarification,
  setEpilogueStatus,
  removeEpilogue,
  setPushback,
  removePushback,
  previewBulkEnrichment,
  launchBulkEnrichment,
  createCustomField,
];

// Backward-compat alias (existing consumers use granularTools):
// includes login + reads + writes for OpenClaw which always exposes everything.
export const granularTools: Tool[] = [
  login,
  ...agentMemoryTools,
  ...granularReadTools,
  ...granularWriteTools,
];
granularTools.forEach((t) => {
  t.advanced = true;
});

// Composite read tools — always exposed (default agent surface).
export const compositeReadTools: Tool[] = [
  pullLeads,
  pullFollowups,
  followupsMap,
  tourPlan,
  listCampaigns,
  campaignProgression,
  campaignCallSheet,
  researchLeadById,
  researchLeadByNameFuzzy,
  // Org qualification methods — the AI-agent questions every lead is scored
  // against. ALWAYS exposed (default surface): "how are my leads qualified"
  // is a first-session question, and the underlying get_taste_profile is
  // ADVANCED-gated. Read-only; no MCP edit endpoint exists (issue #3768).
  getQualificationMethods,
  // Per-lead custom-field VALUES. ALWAYS exposed: complements the always-on
  // list_mappable_fields (which returns DEFINITIONS only). The lead payload
  // embeds each field's definition, so no catalog join is needed (issue #3768).
  getLeadCustomFields,
  // accountHistory layers FULL notes + activity timeline on top of research
  // so the agent can write the US4 "why has this dormant account resurfaced"
  // narrative in ONE call. ALWAYS exposed (compositeReadTools) — the underlying
  // get_lead_notes / get_lead_activities are ADVANCED-gated, but the
  // reprioritize-a-neglected-account workflow (#3630 GAP C) must work in a
  // default deployment without LEADBAY_MCP_ADVANCED=1.
  accountHistory,
  // Bulk portfolio signal scan — read-only, no quota burn. The single-call
  // answer to "which of my leads have signal X" that previously forced a
  // per-lead research_lead_by_id loop (issue #3704).
  scanPortfolioSignals,
  recallOrderedTitles,
  accountStatus,
  bulkEnrichStatus,
  qualifyStatus,
  importStatus,
  resolveImportRows,
  // seed-candidates is a read-only discovery surface for the extend flow.
  // Always exposed so the agent can show candidates even in read-only deployments.
  seedCandidates,
  // listMappableFields is granular-shaped but the import composites depend on
  // it for discoverability; expose it always-on so agents can find custom fields
  // without needing LEADBAY_MCP_ADVANCED=1.
  listMappableFields,
  // listSectors is granular-shaped but ALWAYS exposed: it's the sector taxonomy
  // lookup the agent needs to STOP guessing sector names (and to feed
  // leadbay_new_lens / leadbay_adjust_audience). Without it the agent can only
  // probe sectors by trial-and-error or ask the user to read the web UI.
  listSectors,
  // Billing / top-up tools — granular-shaped but ALWAYS exposed because
  // they're the canonical recovery path from a QUOTA_EXCEEDED wall. If
  // they were gated behind LEADBAY_MCP_ADVANCED=1 the agent would
  // know about the wall but not the door out. Read-only from the
  // agent's POV (creating a Stripe session URL doesn't charge anyone;
  // the user pays in their browser).
  createTopupLink,
  openBillingPortal,
  prepareOutreach,
  // Friction reporting — ALWAYS exposed (must work even in read-only
  // deployments because the most valuable signal is "the tool I tried
  // didn't deliver"). Does not mutate Leadbay state; emits a PostHog
  // event only. Companion to leadbay_report_outreach (which DOES write
  // to the backend and stays gated behind LEADBAY_MCP_WRITE).
  reportFriction,
  // Notification ack — ALWAYS exposed even though it POSTs to /seen.
  // _meta.notifications surfaces terminal bulk-progress notifications on
  // every tool response regardless of write gating; without ack the agent
  // sees the same entries on every call forever. Pairing the surfacing
  // channel with the clearing tool is non-optional.
  acknowledgeNotification,
];

// Composite write tools — always-exposed in OpenClaw, gated in MCP behind
// LEADBAY_MCP_WRITE=1 (the MCP server filters them out by default).
export const compositeWriteTools: Tool[] = [
  bulkQualifyLeads,
  enrichTitles,
  adjustAudience,
  refinePrompt,
  answerClarification,
  reportOutreach,
  // sendFeedback is granular-shaped (a single call to the telemetry seam →
  // Sentry.captureFeedback, same inbox as the web app's feedback form), so it
  // lives in tools/, NOT composite/. Registered here (not advanced-gated) so
  // users can send feedback in-conversation without LEADBAY_MCP_ADVANCED.
  // Write-gated since it sends data outward. Not in COMPOSITE_FILE_TOOL_NAMES,
  // so _triggered_by is optional (no orchestration / mandatory-intent-trace).
  sendFeedback,
  importLeads,
  importAndQualify,
  // Contact management (product#3703) — each is a single-call relay, so
  // granular-shaped and living in tools/; registered HERE (not granular-gated)
  // so reps can manage contacts in-conversation without LEADBAY_MCP_ADVANCED.
  // Same pattern as likeLead/dislikeLead below. Endpoints (all direct, the
  // ones the web UI uses — NOT the import pipeline, which 401s on some
  // accounts): add → POST /leads/{id}/contacts; remove → archive;
  // pin/unpin → /pin|/unpin; update → /update (snake_case, first/last required).
  addContact,
  removeContact,
  pinContact,
  unpinContact,
  updateContact,
  // createCustomField is granular-shaped but file-import prompts depend on it
  // to preserve source-system links without requiring advanced-tool exposure.
  createCustomField,
  // update/delete custom field — same default-surface rationale as create.
  // delete is destructive (requires confirm:true). Both gated behind
  // LEADBAY_MCP_WRITE=1 in MCP. The qualification-questions counterpart has no
  // API write endpoint, so there is intentionally no modify tool for those.
  updateCustomField,
  deleteCustomField,
  // addNote is granular-shaped but file-import prompts depend on it to preserve
  // meaningful source-file notes after imports return lead ids.
  addNote,
  // likeLead/dislikeLead are granular-shaped but should always be available
  // to the agent without requiring LEADBAY_MCP_ADVANCED=1.
  likeLead,
  dislikeLead,
  // Campaign write composites — persist a hand-picked cohort of leads.
  // Backend POST endpoints; gated behind LEADBAY_MCP_WRITE=1 in MCP.
  createCampaign,
  addLeadsToCampaign,
  removeLeadsFromCampaign,
  // Lens extend — agent-driven on-demand fill (additive). Gated behind
  // LEADBAY_MCP_WRITE=1. Subject to per-org daily LENS_EXTRA_REFILL quota.
  extendLens,
  // Lens list/switch — read-first (no args = pure list); a switchToLensId
  // changes the active lens. In compositeWriteTools because the switch path
  // mutates last_requested_lens, but it stays on the default surface
  // (write is on by default since 0.3.0).
  myLenses,
  // Lens creation — make a brand-new named lens with sectors/sizes in one
  // call. Default-surface so "create a lens called X for Y" works without
  // the advanced gate.
  newLens,
];

// Backward-compat alias for existing consumers.
export const compositeTools: Tool[] = [
  ...compositeReadTools,
  ...compositeWriteTools,
];

export const tools: Tool[] = [...compositeTools, ...granularTools];
