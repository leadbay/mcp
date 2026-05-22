import { appendFile, mkdir, readFile } from "node:fs/promises";
import {
  AgentMemoryEntrySchema,
  AgentMemoryTombstoneSchema,
  type AgentMemoryEntry,
  type AgentMemoryTombstone,
} from "./schema.js";
import { resolveAgentMemoryPaths } from "./paths.js";

async function readJsonl<T>(
  path: string,
  parse: (value: unknown) => T
): Promise<T[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err: any) {
    if (err?.code === "ENOENT") return [];
    throw err;
  }

  const out: T[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(parse(JSON.parse(trimmed)));
    } catch {
      // Corrupt lines are ignored so one bad append does not brick recall.
    }
  }
  return out;
}

async function appendJsonl(path: string, dir: string, value: unknown): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await appendFile(path, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600 });
}

export async function readEntries(accountId: string): Promise<AgentMemoryEntry[]> {
  const paths = resolveAgentMemoryPaths(accountId);
  return readJsonl(paths.entriesPath, (value) => AgentMemoryEntrySchema.parse(value));
}

export async function readTombstones(
  accountId: string
): Promise<AgentMemoryTombstone[]> {
  const paths = resolveAgentMemoryPaths(accountId);
  return readJsonl(paths.tombstonesPath, (value) =>
    AgentMemoryTombstoneSchema.parse(value)
  );
}

export async function appendEntry(
  accountId: string,
  entry: AgentMemoryEntry
): Promise<AgentMemoryEntry> {
  const paths = resolveAgentMemoryPaths(accountId);
  const parsed = AgentMemoryEntrySchema.parse(entry);
  await appendJsonl(paths.entriesPath, paths.dir, parsed);
  return parsed;
}

export async function appendTombstone(
  accountId: string,
  tombstone: AgentMemoryTombstone
): Promise<AgentMemoryTombstone> {
  const paths = resolveAgentMemoryPaths(accountId);
  const parsed = AgentMemoryTombstoneSchema.parse(tombstone);
  await appendJsonl(paths.tombstonesPath, paths.dir, parsed);
  return parsed;
}
