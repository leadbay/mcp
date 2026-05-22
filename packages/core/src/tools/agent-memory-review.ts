import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext } from "../types.js";
import {
  appendEntry,
  appendTombstone,
  consolidate,
  ensureAgentMemorySummary,
  hashAccountId,
  invalidateAgentMemoryCache,
  makeAgentMemoryEntry,
  makeAgentMemoryTombstone,
  readEntries,
  readTombstones,
  type AgentMemoryEntry,
} from "../agent-memory/index.js";
import { leadbay_agent_memory_review as AGENT_MEMORY_REVIEW_DESCRIPTION } from "../tool-descriptions.generated.js";

interface AgentMemoryReviewParams {
  action?: "list" | "retract" | "prune" | "promote";
  entry_id?: string;
  key?: string;
  type?: string;
  reason?: string;
  user_confirmation?: string;
  dry_run?: boolean;
}

function findEntry(
  entries: AgentMemoryEntry[],
  params: AgentMemoryReviewParams
): AgentMemoryEntry | null {
  if (params.entry_id) {
    return entries.find((entry) => entry.id === params.entry_id) ?? null;
  }
  if (params.key && params.type) {
    return (
      [...entries]
        .reverse()
        .find((entry) => entry.key === params.key && entry.type === params.type) ?? null
    );
  }
  return null;
}

async function confirmReviewAction(
  params: AgentMemoryReviewParams,
  target: AgentMemoryEntry,
  ctx?: ToolContext
): Promise<string | null> {
  if (params.user_confirmation?.trim()) return params.user_confirmation.trim();
  if (typeof ctx?.elicit !== "function") return null;
  const action = params.action === "promote" ? "promote to org scope" : "retract";
  const result = await ctx.elicit({
    message: `An AI agent wants to ${action} memory '${target.key}' (${target.type}): "${target.insight}". Type a short confirmation to proceed; cancel to leave memory unchanged.`,
    requestedSchema: {
      type: "object",
      properties: {
        confirmation: {
          type: "string",
          title: "Confirmation",
          description: "A few words confirming this memory review action.",
        },
      },
      required: ["confirmation"],
    },
  });
  if (result.action !== "accept") return null;
  const text = String((result.content as any)?.confirmation ?? "").trim();
  return text || null;
}

export const agentMemoryReview: Tool<AgentMemoryReviewParams> = {
  name: "leadbay_agent_memory_review",
  annotations: {
    title: "Review Leadbay agent memory",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  description: AGENT_MEMORY_REVIEW_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["list", "retract", "prune", "promote"],
        description:
          "Default list. retract/prune appends a tombstone; promote appends an org-scoped copy.",
      },
      entry_id: { type: "string", description: "Specific memory entry id." },
      key: { type: "string", description: "Memory key when entry_id is unknown." },
      type: { type: "string", description: "Memory type when entry_id is unknown." },
      reason: { type: "string", description: "Optional reason for the review action." },
      user_confirmation: {
        type: "string",
        description:
          "Fallback confirmation text when the host cannot use elicitation/create.",
      },
      dry_run: { type: "boolean", description: "Preview the change without writing." },
    },
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      action: { type: "string" },
      summary: { type: "string" },
      entries: { type: "array", items: { type: "object" } },
      changed: { type: "boolean" },
      _meta: { type: "object" },
    },
    required: ["action", "summary", "entries", "changed"],
  },
  execute: async (
    client: LeadbayClient,
    params: AgentMemoryReviewParams,
    ctx?: ToolContext
  ) => {
    const me = await client.resolveMe();
    const accountId = me.organization.id;
    const [entries, tombstones] = await Promise.all([
      readEntries(accountId),
      readTombstones(accountId),
    ]);
    const action = params.action ?? "list";
    const digest = consolidate(entries, tombstones, new Date(), { limit: 100 });

    if (action === "list") {
      return {
        action,
        summary: ensureAgentMemorySummary(digest.summary),
        entries: digest.entries,
        changed: false,
        _meta: {
          version: 1,
          region: client.region,
          account_id_hash: hashAccountId(accountId),
        },
      };
    }

    const target = findEntry(entries, params);
    if (!target) {
      return {
        error: true,
        code: "MEMORY_ENTRY_NOT_FOUND",
        message: "No matching memory entry found.",
        hint: "Pass entry_id from leadbay_agent_memory_review, or pass both key and type.",
      };
    }

    const confirmation = await confirmReviewAction(params, target, ctx);
    if (!confirmation) {
      return {
        error: true,
        code: "MEMORY_REVIEW_NOT_CONFIRMED",
        message: "Memory review action was not confirmed; nothing changed.",
        hint:
          "Use host elicitation, or pass user_confirmation with the user's literal confirmation.",
      };
    }

    if (params.dry_run) {
      return {
        action,
        summary: ensureAgentMemorySummary(digest.summary),
        entries: digest.entries,
        changed: false,
        confirmation,
        _meta: {
          version: 1,
          region: client.region,
          account_id_hash: hashAccountId(accountId),
          dry_run: true,
        },
      };
    }

    if (action === "promote") {
      const promoted = makeAgentMemoryEntry({
        key: target.key,
        type: target.type,
        insight: target.insight,
        confidence: target.confidence,
        source: target.source,
        scope: "org",
        validations: target.validations,
        contradictions: target.contradictions,
        tool_context: "agent_memory_review",
      });
      await appendEntry(accountId, promoted);
      invalidateAgentMemoryCache(accountId);
      const post = consolidate([...entries, promoted], tombstones, new Date(), {
        limit: 100,
      });
      return {
        action,
        summary: ensureAgentMemorySummary(post.summary),
        entries: post.entries,
        changed: true,
        promoted,
        confirmation,
        _meta: {
          version: 1,
          region: client.region,
          account_id_hash: hashAccountId(accountId),
          memory_action: "promoted",
        },
      };
    }

    const tombstone = makeAgentMemoryTombstone({
      key: target.key,
      type: target.type,
      normalized_insight: target.normalized_insight,
      reason: params.reason ?? confirmation,
      scope: target.scope,
    });
    await appendTombstone(accountId, tombstone);
    invalidateAgentMemoryCache(accountId);
    const post = consolidate(entries, [...tombstones, tombstone], new Date(), {
      limit: 100,
    });
    return {
      action,
      summary: ensureAgentMemorySummary(post.summary),
      entries: post.entries,
      changed: true,
      tombstone,
      confirmation,
      _meta: {
        version: 1,
        region: client.region,
        account_id_hash: hashAccountId(accountId),
        memory_action: "pruned",
      },
    };
  },
};
