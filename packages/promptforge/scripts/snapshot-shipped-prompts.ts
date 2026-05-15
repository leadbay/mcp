#!/usr/bin/env tsx
/**
 * One-shot script: capture the currently-shipped rendered body of each MCP
 * prompt to packages/promptforge/test/snapshots/<name>.pre-migration.txt.
 *
 * IRON RULE (eng-review T1): before migrating each prompt to .md.tmpl, the
 * current rendered body is snapshotted so freshness tests can assert
 * byte-equality post-migration. Approved drift updates the snapshot.
 *
 * Run with: pnpm tsx packages/promptforge/scripts/snapshot-shipped-prompts.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getPrompt } from "@leadbay/mcp/src/prompts.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SNAPSHOTS_DIR = resolve(__dirname, "..", "test", "snapshots");

// Default arg values used to render the current shipped prompt. After migration,
// the .md.tmpl body uses {{arg:NAME}} placeholders; the runtime render(args) in
// prompts.ts substitutes these with the same defaults. The freshness test
// re-renders with these same args and asserts byte-equality with the snapshot.
const DEFAULT_ARGS: Record<string, Record<string, string>> = {
  leadbay_daily_check_in: {},
  leadbay_research_a_domain: { domain: "<<DOMAIN_PLACEHOLDER>>" },
  leadbay_import_file: { file: "<<FILE_PLACEHOLDER>>", instruction: "<<INSTRUCTION_PLACEHOLDER>>" },
  leadbay_refine_audience: { instruction: "<<INSTRUCTION_PLACEHOLDER>>" },
  leadbay_log_outreach: { lead_id: "<<LEAD_ID_PLACEHOLDER>>", summary: "<<SUMMARY_PLACEHOLDER>>" },
  leadbay_qualify_top_n: { count: "10" },
};

function main(): void {
  mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  for (const [name, args] of Object.entries(DEFAULT_ARGS)) {
    let result;
    try {
      result = getPrompt(name, args);
    } catch (err) {
      console.error(`SKIP ${name}: ${(err as Error).message}`);
      continue;
    }
    // The shipped renderer returns PromptMessage[] with a single user message
    // whose content is `{ type: "text", text }`. Concatenate text fields.
    const body = result.messages
      .map((m) => {
        const c = m.content as { type: string; text?: string };
        return c.type === "text" && typeof c.text === "string" ? c.text : "";
      })
      .join("\n");
    const path = join(SNAPSHOTS_DIR, `${name}.shipped.txt`);
    writeFileSync(path, body, "utf8");
    console.log(`wrote ${path} (${body.length} bytes)`);
  }
}

main();
