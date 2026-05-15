/**
 * Audit: generated files must be in sync with the .md.tmpl sources.
 *
 * Re-runs the assembler in dry mode and asserts the in-memory output
 * matches the checked-in prompts.generated.ts and tool-descriptions.generated.ts
 * byte-for-byte. Stale generated files = CI fail.
 *
 * This is the freshness gate referenced by `pnpm prompts:check`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { assemble } from "../src/assembler.js";
import { emit } from "../src/emit.js";
import { discoverRegisteredTools } from "../src/registry.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PKG_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(PKG_ROOT, "..", "..");
const CORE_SRC = join(REPO_ROOT, "packages", "core", "src");
const PROMPTS_OUT = join(REPO_ROOT, "packages", "mcp", "src", "prompts.generated.ts");
const TOOL_DESC_OUT = join(REPO_ROOT, "packages", "core", "src", "tool-descriptions.generated.ts");

describe("audit: generated files freshness", () => {
  const registered = discoverRegisteredTools(CORE_SRC);
  const result = assemble({ root: PKG_ROOT, registeredToolNames: registered });
  const { promptsModule, toolDescriptionsModule } = emit(result);

  it("prompts.generated.ts is in sync with .md.tmpl sources", () => {
    expect(existsSync(PROMPTS_OUT)).toBe(true);
    const current = readFileSync(PROMPTS_OUT, "utf8");
    expect(current).toBe(promptsModule);
  });

  it("tool-descriptions.generated.ts is in sync with .md.tmpl sources", () => {
    expect(existsSync(TOOL_DESC_OUT)).toBe(true);
    const current = readFileSync(TOOL_DESC_OUT, "utf8");
    expect(current).toBe(toolDescriptionsModule);
  });
});
