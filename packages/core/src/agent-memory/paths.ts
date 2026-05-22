import { homedir } from "node:os";
import { join } from "node:path";

export interface AgentMemoryPaths {
  dir: string;
  entriesPath: string;
  tombstonesPath: string;
}

function sanitizeAccountId(accountId: string): string {
  const trimmed = accountId.trim();
  if (!trimmed) return "unknown";
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function resolveAgentMemoryRoot(): string {
  if (process.env.LEADBAY_AGENT_MEMORY_ROOT) {
    return process.env.LEADBAY_AGENT_MEMORY_ROOT;
  }
  if (process.env.XDG_DATA_HOME) {
    return join(process.env.XDG_DATA_HOME, "leadbay", "memory");
  }
  return join(homedir(), ".leadbay", "memory");
}

export function resolveAgentMemoryPaths(accountId: string): AgentMemoryPaths {
  const dir = join(resolveAgentMemoryRoot(), sanitizeAccountId(accountId));
  return {
    dir,
    entriesPath: join(dir, "entries.jsonl"),
    tombstonesPath: join(dir, "tombstones.jsonl"),
  };
}
