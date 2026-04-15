import { LeadbayClient } from "./client.js";
import { registerListLenses } from "./tools/list-lenses.js";
import { registerDiscoverLeads } from "./tools/discover-leads.js";
import { registerGetLeadProfile } from "./tools/get-lead-profile.js";
import { registerQualifyLead } from "./tools/qualify-lead.js";
import { registerEnrichContacts } from "./tools/enrich-contacts.js";
import { registerGetContacts } from "./tools/get-contacts.js";
import { registerAddNote } from "./tools/add-note.js";
import { registerGetQuota } from "./tools/get-quota.js";
import { registerGetTasteProfile } from "./tools/get-taste-profile.js";
import { registerGetLeadActivities } from "./tools/get-lead-activities.js";

const REGIONS: Record<string, string> = {
  us: "https://api-us.leadbay.app",
  fr: "https://api-fr.leadbay.app",
};

// OpenClaw plugin entry point
// api.pluginConfig is a plain object validated against configSchema in openclaw.plugin.json

export async function register(api: any) {
  const cfg = api.pluginConfig ?? {};

  const region = cfg.region;
  const baseUrl = cfg.baseUrl ?? REGIONS[region];

  if (!baseUrl) {
    api.logger?.warn?.(
      'LeadClaw: Missing region config. Set it via: openclaw config set plugins.entries.leadclaw.region "us"'
    );
    return;
  }

  const token = cfg.token;

  if (!token) {
    api.logger?.warn?.(
      "LeadClaw: No token configured. Authenticate first:\n" +
        '  1. openclaw config set plugins.entries.leadclaw.region "us"   (or "fr")\n' +
        "  2. openclaw config set plugins.entries.leadclaw.token YOUR_TOKEN"
    );
    return;
  }

  if (typeof token !== "string" || !token.startsWith("u.")) {
    api.logger?.warn?.(
      "LeadClaw: Invalid token format. Expected a Leadbay user token (u.xxx)."
    );
    return;
  }

  const client = new LeadbayClient(baseUrl, token);

  // Prefetch org data and taste profile (fire-and-forget)
  client.prefetchOrgData().catch(() => {});

  // Read-only tools (enabled by default)
  registerListLenses(api, client);
  registerDiscoverLeads(api, client);
  registerGetLeadProfile(api, client);
  registerGetContacts(api, client);
  registerGetQuota(api, client);
  registerGetTasteProfile(api, client);
  registerGetLeadActivities(api, client);

  // Write tools (optional: true — user must explicitly enable)
  registerQualifyLead(api, client);
  registerEnrichContacts(api, client);
  registerAddNote(api, client);
}
