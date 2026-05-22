import { createHash, randomUUID } from "node:crypto";
import type { LeadbayClient } from "../client.js";
import type { ToolContext } from "../types.js";
import { consolidate, normalizeInsight } from "./consolidator.js";
import { readEntries, readTombstones } from "./store.js";
import type { AgentMemoryEntry, AgentMemoryTombstone } from "./schema.js";

const CACHE_TTL_MS = 30_000;
const EMPTY_SUMMARY = "## Recent memory\n\n_(no entries yet)_";

export interface AgentMemoryMeta {
  version: 1;
  summary: string;
  top_keys: string[];
  total_active: number;
}

interface CacheEntry {
  expiresAt: number;
  meta: AgentMemoryMeta;
}

const summaryCache = new Map<string, CacheEntry>();

export function createAgentMemoryId(): string {
  return randomUUID();
}

export function hashAccountId(accountId: string): string {
  return createHash("sha256").update(accountId).digest("hex").slice(0, 16);
}

export function isAgentMemoryEnabled(): boolean {
  return (process.env.LEADBAY_AGENT_MEMORY ?? "").toLowerCase() !== "off";
}

export function clearAgentMemoryCache(): void {
  summaryCache.clear();
}

export function ensureAgentMemorySummary(summary: string): string {
  return summary.trim() ? summary : EMPTY_SUMMARY;
}

export function invalidateAgentMemoryCache(accountId: string): void {
  summaryCache.delete(accountId);
}

export async function resolveAgentMemorySummary(args: {
  accountId: string;
  now?: Date;
}): Promise<AgentMemoryMeta> {
  const now = args.now ?? new Date();
  const cached = summaryCache.get(args.accountId);
  if (cached && cached.expiresAt > now.getTime()) return cached.meta;

  const [entries, tombstones] = await Promise.all([
    readEntries(args.accountId),
    readTombstones(args.accountId),
  ]);
  const digest = consolidate(entries, tombstones, now);
  const meta: AgentMemoryMeta = {
    version: 1,
    summary: ensureAgentMemorySummary(digest.summary),
    top_keys: digest.top_keys,
    total_active: digest.total_active,
  };
  summaryCache.set(args.accountId, {
    expiresAt: now.getTime() + CACHE_TTL_MS,
    meta,
  });
  return meta;
}

export async function resolveAgentMemoryForClient(
  client: LeadbayClient,
  accountId?: string
): Promise<AgentMemoryMeta> {
  const resolvedAccountId = accountId ?? (await client.resolveMe()).organization.id;
  return resolveAgentMemorySummary({ accountId: resolvedAccountId });
}

export async function withAgentMemoryMeta<T extends Record<string, any>>(
  client: LeadbayClient,
  result: T,
  ctx?: ToolContext,
  accountId?: string
): Promise<T> {
  if (!isAgentMemoryEnabled()) return result;
  try {
    const agentMemory = await resolveAgentMemoryForClient(client, accountId);
    return {
      ...result,
      _meta: {
        ...(result._meta ?? {}),
        agent_memory: agentMemory,
      },
    };
  } catch (err: any) {
    ctx?.logger?.warn?.(
      `agent_memory: failed to attach summary: ${err?.message ?? err?.code ?? err}`
    );
    return result;
  }
}

export function makeAgentMemoryEntry(
  input: Omit<AgentMemoryEntry, "id" | "normalized_insight" | "ts"> & {
    id?: string;
    normalized_insight?: string;
    ts?: string;
  }
): AgentMemoryEntry {
  return {
    ...input,
    id: input.id ?? createAgentMemoryId(),
    normalized_insight:
      input.normalized_insight ?? normalizeInsight(input.insight),
    ts: input.ts ?? new Date().toISOString(),
    validations: input.validations ?? 0,
    contradictions: input.contradictions ?? 0,
  };
}

export function makeAgentMemoryTombstone(
  input: Omit<AgentMemoryTombstone, "id" | "ts"> & {
    id?: string;
    ts?: string;
  }
): AgentMemoryTombstone {
  return {
    ...input,
    id: input.id ?? createAgentMemoryId(),
    ts: input.ts ?? new Date().toISOString(),
  };
}

export * from "./consolidator.js";
export * from "./injection-guard.js";
export * from "./paths.js";
export * from "./schema.js";
export * from "./store.js";
