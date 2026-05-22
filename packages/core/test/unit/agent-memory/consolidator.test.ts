import { describe, expect, it } from "vitest";
import {
  consolidate,
  normalizeInsight,
  type AgentMemoryEntry,
  type AgentMemoryTombstone,
} from "../../../src/agent-memory/index.js";

function entry(
  id: string,
  overrides: Partial<AgentMemoryEntry> = {}
): AgentMemoryEntry {
  const insight = overrides.insight ?? "healthcare IT";
  return {
    id,
    key: "preferred_sector",
    type: "preference",
    insight,
    normalized_insight: normalizeInsight(insight),
    confidence: 8,
    source: "user_stated",
    scope: "user",
    ts: "2026-01-01T00:00:00.000Z",
    validations: 0,
    contradictions: 0,
    ...overrides,
  };
}

describe("agent-memory consolidator", () => {
  it("does not decay user_stated entries", () => {
    const digest = consolidate(
      [entry("a", { confidence: 9, source: "user_stated" })],
      [],
      new Date("2027-01-01T00:00:00.000Z")
    );
    expect(digest.entries[0].effective_confidence).toBe(9);
  });

  it("decays observed and inferred entries by one point per 30 days", () => {
    const digest = consolidate(
      [entry("a", { confidence: 9, source: "observed" })],
      [],
      new Date("2026-03-05T00:00:00.000Z")
    );
    expect(digest.entries[0].effective_confidence).toBe(7);
  });

  it("keeps the newer entry within the same normalized bucket on ties", () => {
    const digest = consolidate(
      [
        entry("old", { ts: "2026-01-01T00:00:00.000Z" }),
        entry("new", { ts: "2026-02-01T00:00:00.000Z" }),
      ],
      [],
      new Date("2026-02-02T00:00:00.000Z")
    );
    expect(digest.entries[0].id).toBe("new");
  });

  it("suppresses entries older than a matching tombstone", () => {
    const tombstone: AgentMemoryTombstone = {
      id: "t",
      key: "preferred_sector",
      type: "preference",
      scope: "user",
      ts: "2026-02-01T00:00:00.000Z",
    };
    const digest = consolidate(
      [entry("a", { ts: "2026-01-01T00:00:00.000Z" })],
      [tombstone],
      new Date("2026-02-02T00:00:00.000Z")
    );
    expect(digest.summary).toBe("");
    expect(digest.entries).toEqual([]);
  });

  it("bounds digest size even with many long inputs", () => {
    const entries = Array.from({ length: 200 }, (_, i) =>
      entry(`e-${i}`, {
        key: `key_${i}`,
        insight: `Very long preference ${i} `.repeat(80),
        normalized_insight: normalizeInsight(`Very long preference ${i}`),
        confidence: 10,
      })
    );
    const digest = consolidate(entries, [], new Date("2026-02-02T00:00:00.000Z"));
    expect(Buffer.byteLength(digest.summary, "utf8")).toBeLessThanOrEqual(2048);
  });

  it("is idempotent over its consolidated entries", () => {
    const entries = [
      entry("a", { insight: "Healthcare IT." }),
      entry("b", { insight: "healthcare it" }),
      entry("c", { insight: "consumer retail", confidence: 5 }),
    ];
    const once = consolidate(entries, [], new Date("2026-02-02T00:00:00.000Z"));
    const twice = consolidate(once.entries, [], new Date("2026-02-02T00:00:00.000Z"));
    expect(twice.summary).toBe(once.summary);
    expect(twice.top_keys).toEqual(once.top_keys);
  });
});
