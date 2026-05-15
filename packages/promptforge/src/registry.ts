import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const TOOL_NAME_PATTERN = /\bname:\s*"(leadbay_[a-z0-9_]+)"/g;

/**
 * Discover registered tool names by scanning the @leadbay/core source tree.
 * Looks for `name: "leadbay_..."` literals in tools/*.ts and composite/*.ts.
 *
 * This is a build-time heuristic. The audit-compliance test #6 (tool name
 * convention) and a separate audit test that imports from @leadbay/core
 * keep this list honest against the actual runtime registry.
 */
export function discoverRegisteredTools(coreSrcRoot: string): Set<string> {
  const names = new Set<string>();
  const scan = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      const stat = statSync(path);
      if (stat.isDirectory()) {
        scan(path);
      } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts") && !entry.endsWith(".generated.ts")) {
        const source = readFileSync(path, "utf8");
        for (const match of source.matchAll(TOOL_NAME_PATTERN)) {
          names.add(match[1]);
        }
      }
    }
  };
  scan(join(coreSrcRoot, "tools"));
  scan(join(coreSrcRoot, "composite"));
  return names;
}
