export { LeadbayClient, createClient, REGIONS } from "./client.js";
export type { CreateClientConfig, TasteProfileResult } from "./client.js";
export * from "./types.js";

// Granular tools (11, 1:1 with Leadbay API endpoints)
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

// Composite workflow tools (3, MCP primary surface)
import { findProspects } from "./composite/find-prospects.js";
import { researchCompany } from "./composite/research-company.js";
import { prepareOutreach } from "./composite/prepare-outreach.js";

import type { Tool } from "./types.js";

export {
  login,
  listLenses,
  discoverLeads,
  getLeadProfile,
  getContacts,
  getQuota,
  getTasteProfile,
  qualifyLead,
  enrichContacts,
  addNote,
  getLeadActivities,
  findProspects,
  researchCompany,
  prepareOutreach,
};

export const granularTools: Tool[] = [
  login,
  listLenses,
  discoverLeads,
  getLeadProfile,
  getLeadActivities,
  getTasteProfile,
  getContacts,
  getQuota,
  qualifyLead,
  enrichContacts,
  addNote,
];

// Mark the granular tools as advanced so MCP can opt them out of the default list.
granularTools.forEach((t) => {
  t.advanced = true;
});

export const compositeTools: Tool[] = [
  findProspects,
  researchCompany,
  prepareOutreach,
];

export const tools: Tool[] = [...compositeTools, ...granularTools];
