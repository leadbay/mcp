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
import { getUserPrompt } from "./tools/get-user-prompt.js";
import { getClarification } from "./tools/get-clarification.js";
import { getLeadNotes } from "./tools/get-lead-notes.js";
import { getEpilogueResponses } from "./tools/get-epilogue-responses.js";
import { getProspectingActions } from "./tools/get-prospecting-actions.js";
import { getWebFetch } from "./tools/get-web-fetch.js";
import { getSelectionIds } from "./tools/get-selection-ids.js";
import { getEnrichmentJobTitles } from "./tools/get-enrichment-job-titles.js";
import { listMappableFields } from "./tools/list-mappable-fields.js";

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
import { previewBulkEnrichment } from "./tools/preview-bulk-enrichment.js";
import { launchBulkEnrichment } from "./tools/launch-bulk-enrichment.js";

// ─── Composite workflow tools — agent-facing surface ─────────────────────

// Existing
import { researchCompany } from "./composite/research-company.js";
import { prepareOutreach } from "./composite/prepare-outreach.js";

// New (autoplan §E4 reads + §E6 writes)
import { pullLeads } from "./composite/pull-leads.js";
import { researchLead } from "./composite/research-lead.js";
import { recallOrderedTitles } from "./composite/recall-ordered-titles.js";
import { accountStatus } from "./composite/account-status.js";
import { bulkQualifyLeads } from "./composite/bulk-qualify-leads.js";
import { importLeads } from "./composite/import-leads.js";
import { importAndQualify } from "./composite/import-and-qualify.js";
import { qualifyStatus } from "./composite/qualify-status.js";
import { enrichTitles } from "./composite/enrich-titles.js";
import { bulkEnrichStatus } from "./composite/bulk-enrich-status.js";
import { adjustAudience } from "./composite/adjust-audience.js";
import { refinePrompt } from "./composite/refine-prompt.js";
import { answerClarification } from "./composite/answer-clarification.js";
import { reportOutreach } from "./composite/report-outreach.js";

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
  LocalBulkStoreOpts,
  CreateDefaultBulkStoreOpts,
} from "./jobs/bulk-store.js";

// Re-export individual tools for granular consumers
export {
  // existing granular
  login, listLenses, discoverLeads, getLeadProfile, getContacts, getQuota,
  getTasteProfile, qualifyLead, enrichContacts, addNote, getLeadActivities,
  // new granular reads
  getLensFilter, getLensScoring, listSectors, getUserPrompt, getClarification,
  getLeadNotes, getEpilogueResponses, getProspectingActions, getWebFetch,
  getSelectionIds, getEnrichmentJobTitles,
  listMappableFields,
  // new granular writes
  selectLeads, deselectLeads, clearSelection, setActiveLens, createLens,
  updateLens, updateLensFilter, createLensDraft, promoteLens, setUserPrompt,
  clearUserPrompt, pickClarification, dismissClarification, setEpilogueStatus,
  removeEpilogue, previewBulkEnrichment, launchBulkEnrichment,
  // existing composite
  researchCompany, prepareOutreach,
  // new composite reads
  pullLeads, researchLead, recallOrderedTitles, accountStatus,
  bulkEnrichStatus, qualifyStatus,
  // new composite writes
  bulkQualifyLeads, enrichTitles, adjustAudience, refinePrompt,
  answerClarification, reportOutreach, importLeads, importAndQualify,
};

// ─── Tool catalogues ─────────────────────────────────────────────────────

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
  listSectors,
  getUserPrompt,
  getClarification,
  getLeadNotes,
  getEpilogueResponses,
  getProspectingActions,
  getWebFetch,
  getSelectionIds,
  getEnrichmentJobTitles,
  listMappableFields,
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
  previewBulkEnrichment,
  launchBulkEnrichment,
];

// Backward-compat alias (existing consumers use granularTools):
// includes login + reads + writes for OpenClaw which always exposes everything.
export const granularTools: Tool[] = [
  login,
  ...granularReadTools,
  ...granularWriteTools,
];
granularTools.forEach((t) => {
  t.advanced = true;
});

// Composite read tools — always exposed (default agent surface).
export const compositeReadTools: Tool[] = [
  pullLeads,
  researchLead,
  recallOrderedTitles,
  accountStatus,
  bulkEnrichStatus,
  qualifyStatus,
  // listMappableFields is granular-shaped but the import composites depend on
  // it for discoverability; expose it always-on so agents can find custom fields
  // without needing LEADBAY_MCP_ADVANCED=1.
  listMappableFields,
  // Keep the existing composites available too.
  researchCompany,
  prepareOutreach,
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
  importLeads,
  importAndQualify,
];

// Backward-compat alias for existing consumers.
export const compositeTools: Tool[] = [
  ...compositeReadTools,
  ...compositeWriteTools,
];

export const tools: Tool[] = [...compositeTools, ...granularTools];
