/**
 * Audit: COMPOSITE_FILE_TOOL_NAMES stays in sync with the on-disk
 * packages/core/src/composite/ directory.
 *
 * The MCP server keys "mandatory _triggered_by + dedicated composite_call
 * PostHog event" off this Set (see packages/mcp/src/server.ts and
 * packages/core/src/composite/_composite-file-names.ts). Adding a new
 * composite/<stem>.ts without updating the Set silently exempts the new
 * tool from the mandate; removing a composite without updating the Set
 * leaves a phantom membership check. Either drift is invisible without
 * this audit, so we enforce the round-trip.
 */
import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { COMPOSITE_FILE_TOOL_NAMES } from "@leadbay/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/mcp/test/audit -> packages/core/src/composite
const COMPOSITE_DIR = join(
  __dirname,
  "..",
  "..",
  "..",
  "core",
  "src",
  "composite"
);

// `_<stem>.ts` files are shared helpers (e.g. _geo-helpers, _qualify-helpers,
// _composite-file-names). Not tools.
// `find-prospects.ts` is dead — removed from packages/core/src/index.ts but
// the file lingers on disk. Excluded to avoid blocking this PR on an
// unrelated cleanup.
const HELPER_PREFIX = "_";
const DEAD_FILES = new Set(["find-prospects.ts"]);

function fileStemToToolName(filename: string): string {
  return `leadbay_${filename.replace(/\.ts$/, "").replace(/-/g, "_")}`;
}

function listOnDiskCompositeNames(): string[] {
  return readdirSync(COMPOSITE_DIR)
    .filter((entry) => {
      if (!entry.endsWith(".ts")) return false;
      if (entry.endsWith(".test.ts")) return false;
      if (entry.startsWith(HELPER_PREFIX)) return false;
      if (DEAD_FILES.has(entry)) return false;
      const full = join(COMPOSITE_DIR, entry);
      return statSync(full).isFile();
    })
    .map(fileStemToToolName)
    .sort();
}

describe("audit: COMPOSITE_FILE_TOOL_NAMES ↔ composite/ directory", () => {
  it("every composite/<stem>.ts has a corresponding name in COMPOSITE_FILE_TOOL_NAMES", () => {
    const onDisk = listOnDiskCompositeNames();
    const missing = onDisk.filter((name) => !COMPOSITE_FILE_TOOL_NAMES.has(name));
    expect(missing).toEqual([]);
  });

  it("every name in COMPOSITE_FILE_TOOL_NAMES has a matching composite/<stem>.ts on disk", () => {
    const onDisk = new Set(listOnDiskCompositeNames());
    const phantom = [...COMPOSITE_FILE_TOOL_NAMES].filter((name) => !onDisk.has(name));
    expect(phantom).toEqual([]);
  });
});
