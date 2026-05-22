/**
 * Resources catalog — read-only payloads addressable by URI.
 *
 * Per MCP 2025-11-25 §Resources, resources let clients cache stable
 * read-only data across turns and let agents grab specific items
 * without re-running broad fetch tools. We expose three URI schemes:
 *
 *   - lead://{uuid}/profile — a single lead's full profile JSON
 *   - lens://{id}/definition — a lens's filter + scoring config
 *   - org://taste-profile — the org's qualification questions + tags
 *   - agent-memory://summary — consolidated local agent memory markdown
 *
 * The first two are templates (dynamic URIs); the third is a singleton
 * concrete resource always-listed.
 *
 * Backwards-compat: clients without resources capability ignore.
 */

import type {
  Resource,
  ResourceTemplate,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import {
  resolveAgentMemorySummary,
  type LeadbayClient,
} from "@leadbay/core";

const LEAD_URI_RE = /^lead:\/\/([0-9a-f-]{36})\/profile$/i;
const LENS_URI_RE = /^lens:\/\/(\d+)\/definition$/;
const ORG_TASTE_URI = "org://taste-profile";
const AGENT_MEMORY_SUMMARY_URI = "agent-memory://summary";

export function listResources(): Resource[] {
  return [
    {
      uri: ORG_TASTE_URI,
      name: "Org taste profile",
      description:
        "The org's qualification questions, intent tags, and ICP signals — the agent's knowledge base for what makes a lead a fit.",
      mimeType: "application/json",
    },
    {
      uri: AGENT_MEMORY_SUMMARY_URI,
      name: "Agent memory summary",
      description:
        "Consolidated top Leadbay agent-memory signals for this account. Local-file, read-only resource.",
      mimeType: "text/markdown",
    },
  ];
}

export function listResourceTemplates(): ResourceTemplate[] {
  return [
    {
      uriTemplate: "lead://{uuid}/profile",
      name: "Lead profile",
      description:
        "Full profile for a single Leadbay lead by UUID. Read-only. Cached client-side; cheaper than calling leadbay_research_lead_by_id when you already have the id.",
      mimeType: "application/json",
    },
    {
      uriTemplate: "lens://{id}/definition",
      name: "Lens definition",
      description:
        "Filter criteria + scoring config for a Leadbay lens by id. Useful for explaining the active lens or auditing why specific leads surfaced.",
      mimeType: "application/json",
    },
  ];
}

function jsonContent(uri: string, value: unknown): ReadResourceResult {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function textContent(
  uri: string,
  mimeType: string,
  text: string
): ReadResourceResult {
  return {
    contents: [
      {
        uri,
        mimeType,
        text,
      },
    ],
  };
}

export async function readResource(
  uri: string,
  client: LeadbayClient
): Promise<ReadResourceResult> {
  if (uri === ORG_TASTE_URI) {
    const taste = await client.resolveTasteProfile();
    return jsonContent(uri, taste);
  }

  if (uri === AGENT_MEMORY_SUMMARY_URI) {
    const me = await client.resolveMe();
    const memory = await resolveAgentMemorySummary({
      accountId: me.organization.id,
    });
    return textContent(uri, "text/markdown", memory.summary);
  }

  const leadMatch = LEAD_URI_RE.exec(uri);
  if (leadMatch) {
    const leadId = leadMatch[1];
    // Best-effort lens resolution. The lead-by-id endpoint requires a
    // lens; we use the user's last-active lens. If the lead isn't in
    // that lens, the backend 404s — surface as resource error.
    const lensId = await client.resolveDefaultLens();
    const profile = await client.request<unknown>(
      "GET",
      `/lenses/${lensId}/leads/${leadId}`
    );
    return jsonContent(uri, profile);
  }

  const lensMatch = LENS_URI_RE.exec(uri);
  if (lensMatch) {
    const lensId = Number(lensMatch[1]);
    const [filter, scoring] = await Promise.all([
      client.request<unknown>("GET", `/lenses/${lensId}/filter`).catch(() => null),
      client.request<unknown>("GET", `/lenses/${lensId}/scoring`).catch(() => null),
    ]);
    return jsonContent(uri, { lensId, filter, scoring });
  }

  throw new Error(
    `Unsupported resource URI: ${uri}. Supported schemes: lead://{uuid}/profile, lens://{id}/definition, org://taste-profile, agent-memory://summary.`
  );
}
