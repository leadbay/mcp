import type {
  AgentMemoryEntry,
  AgentMemoryTombstone,
} from "./schema.js";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 5;
const DEFAULT_MAX_BYTES = 2048;
const DISTINCT_INSIGHTS_PER_KEY = 2;

export interface ConsolidatedMemoryEntry extends AgentMemoryEntry {
  effective_confidence: number;
}

export interface AgentMemoryDigest {
  summary: string;
  entries: ConsolidatedMemoryEntry[];
  top_keys: string[];
  total_active: number;
}

export interface ConsolidateOptions {
  limit?: number;
  maxBytes?: number;
}

export function normalizeInsight(insight: string): string {
  return insight
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.!?;:,]+$/g, "");
}

function toTime(ts: string): number {
  const n = Date.parse(ts);
  return Number.isFinite(n) ? n : 0;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function effectiveConfidence(entry: AgentMemoryEntry, now: Date): number {
  const ageMs = Math.max(0, now.getTime() - toTime(entry.ts));
  const decays =
    entry.source === "observed" || entry.source === "inferred"
      ? Math.floor(ageMs / THIRTY_DAYS_MS)
      : 0;
  const bonus = Math.min(2, Math.log2((entry.validations ?? 0) + 1));
  const penalty = Math.min(3, entry.contradictions ?? 0);
  return Math.round(clamp(entry.confidence - decays + bonus - penalty, 0, 10) * 10) / 10;
}

function tombstoneSuppresses(
  tombstone: AgentMemoryTombstone,
  entry: AgentMemoryEntry
): boolean {
  if (tombstone.key !== entry.key || tombstone.type !== entry.type) return false;
  if (toTime(tombstone.ts) <= toTime(entry.ts)) return false;
  if (!tombstone.normalized_insight) return true;
  return tombstone.normalized_insight === entry.normalized_insight;
}

function byConfidenceThenRecency(
  a: ConsolidatedMemoryEntry,
  b: ConsolidatedMemoryEntry
): number {
  if (b.effective_confidence !== a.effective_confidence) {
    return b.effective_confidence - a.effective_confidence;
  }
  return toTime(b.ts) - toTime(a.ts);
}

function formatConfidence(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function truncateInsight(text: string, maxChars: number): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

function renderDigest(entries: ConsolidatedMemoryEntry[], maxBytes: number): string {
  if (entries.length === 0) return "";

  let insightChars = 220;
  let candidate = "";
  while (insightChars >= 80) {
    const lines = ["## Recent memory"];
    for (const entry of entries) {
      lines.push(
        `- **${entry.key}** (${entry.source}, conf ${formatConfidence(
          entry.effective_confidence
        )}/10): ${truncateInsight(entry.insight, insightChars)}`
      );
    }
    candidate = lines.join("\n");
    if (Buffer.byteLength(candidate, "utf8") <= maxBytes) return candidate;
    insightChars -= 40;
  }

  const lines = ["## Recent memory"];
  for (const entry of entries) {
    lines.push(
      `- **${entry.key}** (${entry.source}, conf ${formatConfidence(
        entry.effective_confidence
      )}/10): ${truncateInsight(entry.insight, 80)}`
    );
    candidate = lines.join("\n");
    if (Buffer.byteLength(candidate, "utf8") > maxBytes) {
      lines.pop();
      break;
    }
  }
  return lines.join("\n");
}

export function consolidate(
  entries: AgentMemoryEntry[],
  tombstones: AgentMemoryTombstone[] = [],
  now: Date = new Date(),
  options: ConsolidateOptions = {}
): AgentMemoryDigest {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  const active = entries.filter(
    (entry) => !tombstones.some((t) => tombstoneSuppresses(t, entry))
  );

  const bucketBest = new Map<string, ConsolidatedMemoryEntry>();
  for (const raw of active) {
    const entry: AgentMemoryEntry = {
      ...raw,
      normalized_insight: raw.normalized_insight || normalizeInsight(raw.insight),
    };
    const consolidated: ConsolidatedMemoryEntry = {
      ...entry,
      effective_confidence: effectiveConfidence(entry, now),
    };
    const bucketKey = `${entry.key}\0${entry.type}\0${entry.normalized_insight}`;
    const prev = bucketBest.get(bucketKey);
    if (!prev || byConfidenceThenRecency(consolidated, prev) < 0) {
      bucketBest.set(bucketKey, consolidated);
    }
  }

  const byKeyType = new Map<string, ConsolidatedMemoryEntry[]>();
  for (const entry of bucketBest.values()) {
    const key = `${entry.key}\0${entry.type}`;
    const list = byKeyType.get(key) ?? [];
    list.push(entry);
    byKeyType.set(key, list);
  }

  const survivors: ConsolidatedMemoryEntry[] = [];
  for (const list of byKeyType.values()) {
    list.sort(byConfidenceThenRecency);
    survivors.push(...list.slice(0, DISTINCT_INSIGHTS_PER_KEY));
  }
  survivors.sort(byConfidenceThenRecency);

  const top = survivors.slice(0, limit);
  return {
    summary: renderDigest(top, maxBytes),
    entries: top,
    top_keys: top.map((entry) => entry.key),
    total_active: survivors.length,
  };
}
