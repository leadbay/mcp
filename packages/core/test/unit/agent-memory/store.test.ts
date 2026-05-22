import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendEntry,
  appendTombstone,
  makeAgentMemoryEntry,
  makeAgentMemoryTombstone,
  readEntries,
  readTombstones,
  resolveAgentMemoryPaths,
} from "../../../src/agent-memory/index.js";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "leadbay-memory-"));
  process.env.LEADBAY_AGENT_MEMORY_ROOT = root;
});

afterEach(async () => {
  delete process.env.LEADBAY_AGENT_MEMORY_ROOT;
  await rm(root, { recursive: true, force: true });
});

describe("agent-memory JSONL store", () => {
  it("round-trips entries and tombstones", async () => {
    const entry = makeAgentMemoryEntry({
      key: "preferred_sector",
      type: "preference",
      insight: "healthcare IT",
      confidence: 9,
      source: "user_stated",
      scope: "user",
    });
    const tombstone = makeAgentMemoryTombstone({
      key: entry.key,
      type: entry.type,
      normalized_insight: entry.normalized_insight,
      scope: "user",
    });

    await appendEntry("org-1", entry);
    await appendTombstone("org-1", tombstone);

    expect(await readEntries("org-1")).toMatchObject([entry]);
    expect(await readTombstones("org-1")).toMatchObject([tombstone]);
  });

  it("skips corrupt JSONL lines without dropping valid entries", async () => {
    const paths = resolveAgentMemoryPaths("org-1");
    const entry = makeAgentMemoryEntry({
      key: "preferred_region",
      type: "preference",
      insight: "Northeast US",
      confidence: 8,
      source: "user_stated",
      scope: "user",
    });
    await appendEntry("org-1", entry);
    const current = await readFile(paths.entriesPath, "utf8");
    await writeFile(paths.entriesPath, `${current}{bad json}\n`, "utf8");

    expect(await readEntries("org-1")).toHaveLength(1);
  });
});
