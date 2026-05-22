import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";
import {
  consolidate,
  ensureAgentMemorySummary,
  hashAccountId,
  readEntries,
  readTombstones,
} from "../agent-memory/index.js";
import { leadbay_agent_memory_recall as AGENT_MEMORY_RECALL_DESCRIPTION } from "../tool-descriptions.generated.js";

interface AgentMemoryRecallParams {
  key?: string;
  type?: string;
  limit?: number;
}

export const agentMemoryRecall: Tool<AgentMemoryRecallParams> = {
  name: "leadbay_agent_memory_recall",
  annotations: {
    title: "Recall Leadbay agent memory",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  description: AGENT_MEMORY_RECALL_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      key: {
        type: "string",
        description:
          "Optional memory key to narrow recall, e.g. preferred_sector or communication_style.",
      },
      type: {
        type: "string",
        description:
          "Optional memory type to narrow recall, e.g. preference, rule, style, retraction.",
      },
      limit: {
        type: "number",
        description: "Maximum consolidated entries to return (default 5, max 20).",
      },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      summary: { type: "string" },
      top_keys: { type: "array", items: { type: "string" } },
      total_active: { type: "number" },
      entries_returned: { type: "number" },
      _meta: { type: "object" },
    },
    required: ["summary", "top_keys", "total_active", "entries_returned"],
  },
  execute: async (client: LeadbayClient, params: AgentMemoryRecallParams) => {
    const me = await client.resolveMe();
    const accountId = me.organization.id;
    const limit = Math.min(Math.max(params.limit ?? 5, 1), 20);
    let entries = await readEntries(accountId);
    if (params.key) entries = entries.filter((entry) => entry.key === params.key);
    if (params.type) entries = entries.filter((entry) => entry.type === params.type);
    const tombstones = await readTombstones(accountId);
    const digest = consolidate(entries, tombstones, new Date(), { limit });

    return {
      summary: ensureAgentMemorySummary(digest.summary),
      top_keys: digest.top_keys,
      total_active: digest.total_active,
      entries_returned: digest.entries.length,
      _meta: {
        version: 1,
        region: client.region,
        account_id_hash: hashAccountId(accountId),
      },
    };
  },
};
