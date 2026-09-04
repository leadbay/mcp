#!/usr/bin/env node
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { assemble, type AssembleResult } from "./assembler.js";
import { emit, emitServerInstructions, diff, writeIfDifferent } from "./emit.js";
import { buildSkillFiles, type SkillFile } from "./skills.js";
import { discoverRegisteredTools } from "./registry.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// src/cli.ts sits in packages/promptforge/{src,dist}; PKG_ROOT is two up from this file.
const PKG_ROOT = resolve(__dirname, "..");
const REPO_ROOT = resolve(PKG_ROOT, "..", "..");

const CORE_SRC = join(REPO_ROOT, "packages", "core", "src");
const PROMPTS_OUT = join(REPO_ROOT, "packages", "mcp", "src", "prompts.generated.ts");
const TOOL_DESC_OUT = join(REPO_ROOT, "packages", "core", "src", "tool-descriptions.generated.ts");
const SERVER_INSTRUCTIONS_OUT = join(
  REPO_ROOT,
  "packages",
  "mcp",
  "src",
  "server-instructions.generated.ts",
);
const SERVER_INSTRUCTIONS_SNIPPETS = join(
  PKG_ROOT,
  "snippets",
  "server-instructions",
);
const SKILLS_OUT_DIR = join(
  REPO_ROOT,
  ".claude-plugin",
  "plugins",
  "leadbay",
  "skills",
);
const SNAPSHOTS_DIR = join(PKG_ROOT, "test", "snapshots");

type Mode = "build" | "check" | "approve-drift";

function parseArgs(argv: string[]): { mode: Mode; positional: string[] } {
  const [, , mode, ...rest] = argv;
  if (mode !== "build" && mode !== "check" && mode !== "approve-drift") {
    throw new Error(`unknown command: ${mode ?? "<missing>"}. Use: build | check | approve-drift <name>`);
  }
  return { mode, positional: rest };
}

interface AssembleAndEmitOutput {
  promptsModule: string;
  toolDescriptionsModule: string;
  skillFiles: SkillFile[];
  // Prompts marked release_gated emit NO SKILL.md. Their paths are returned so
  // the build can DELETE a previously-emitted skill: writeIfDifferent only
  // writes, so a prompt gated after the fact would otherwise leave a static,
  // auto-triggering skill on disk to be committed and shipped.
  gatedSkillPaths: string[];
  result: AssembleResult;
}

function runAssemble(): AssembleAndEmitOutput {
  const registered = discoverRegisteredTools(CORE_SRC);
  const result = assemble({ root: PKG_ROOT, registeredToolNames: registered });
  const { promptsModule, toolDescriptionsModule } = emit(result);
  const skillFiles = buildSkillFiles(result.prompts);
  const gatedSkillPaths = result.prompts
    .filter((p) => p.frontmatter.release_gated === true)
    .map((p) => join(SKILLS_OUT_DIR, p.frontmatter.name, "SKILL.md"));
  return { promptsModule, toolDescriptionsModule, skillFiles, gatedSkillPaths, result };
}

function cmdBuild(): void {
  const { promptsModule, toolDescriptionsModule, skillFiles, gatedSkillPaths } =
    runAssemble();
  const serverInstructionsModule = emitServerInstructions(SERVER_INSTRUCTIONS_SNIPPETS);
  const r1 = writeIfDifferent(PROMPTS_OUT, promptsModule);
  const r2 = writeIfDifferent(TOOL_DESC_OUT, toolDescriptionsModule);
  const r3 = writeIfDifferent(SERVER_INSTRUCTIONS_OUT, serverInstructionsModule);
  console.log(`[forge] ${PROMPTS_OUT.replace(REPO_ROOT + "/", "")}: ${r1.changed ? "wrote" : "unchanged"}`);
  console.log(`[forge] ${TOOL_DESC_OUT.replace(REPO_ROOT + "/", "")}: ${r2.changed ? "wrote" : "unchanged"}`);
  console.log(`[forge] ${SERVER_INSTRUCTIONS_OUT.replace(REPO_ROOT + "/", "")}: ${r3.changed ? "wrote" : "unchanged"}`);
  for (const skill of skillFiles) {
    const fullPath = join(SKILLS_OUT_DIR, skill.relativePath);
    const r = writeIfDifferent(fullPath, skill.content);
    console.log(
      `[forge] ${fullPath.replace(REPO_ROOT + "/", "")}: ${r.changed ? "wrote" : "unchanged"}`,
    );
  }
  // A skill is a static file that auto-triggers with no runtime gate, so a
  // prompt marked release_gated must not leave one behind. writeIfDifferent
  // only ever writes, so deletion has to be explicit.
  for (const path of gatedSkillPaths) {
    if (existsSync(path)) {
      rmSync(dirname(path), { recursive: true, force: true });
      console.log(
        `[forge] ${path.replace(REPO_ROOT + "/", "")}: removed (release_gated)`,
      );
    }
  }
}

function cmdCheck(): void {
  const { promptsModule, toolDescriptionsModule, skillFiles, gatedSkillPaths } =
    runAssemble();
  const serverInstructionsModule = emitServerInstructions(SERVER_INSTRUCTIONS_SNIPPETS);
  const d1 = diff(PROMPTS_OUT, promptsModule);
  const d2 = diff(TOOL_DESC_OUT, toolDescriptionsModule);
  const d3 = diff(SERVER_INSTRUCTIONS_OUT, serverInstructionsModule);
  const staleSkills: string[] = [];
  for (const skill of skillFiles) {
    const fullPath = join(SKILLS_OUT_DIR, skill.relativePath);
    if (!diff(fullPath, skill.content).matches) staleSkills.push(fullPath);
  }
  // A gated prompt must ship NO skill — a leftover file would auto-trigger a
  // workflow whose tools are hidden, so fail rather than let it be committed.
  const orphanedGated = gatedSkillPaths.filter((p) => existsSync(p));
  if (
    !d1.matches ||
    !d2.matches ||
    !d3.matches ||
    staleSkills.length > 0 ||
    orphanedGated.length > 0
  ) {
    if (!d1.matches) console.error(`[forge] ${PROMPTS_OUT} is stale. Run pnpm prompts:build.`);
    if (!d2.matches) console.error(`[forge] ${TOOL_DESC_OUT} is stale. Run pnpm prompts:build.`);
    if (!d3.matches) console.error(`[forge] ${SERVER_INSTRUCTIONS_OUT} is stale. Run pnpm prompts:build.`);
    for (const path of staleSkills) {
      console.error(`[forge] ${path} is stale. Run pnpm prompts:build.`);
    }
    for (const path of orphanedGated) {
      console.error(
        `[forge] ${path} belongs to a release_gated prompt and must not ship. Run pnpm prompts:build.`,
      );
    }
    process.exit(1);
  }
  console.log("[forge] generated files are up-to-date.");
}

function cmdApproveDrift(name: string): void {
  if (!name) throw new Error("approve-drift requires a name: pnpm prompts:approve-drift <prompt_or_tool_name>");
  // Pre-migration snapshot management: capture the current rendered body of the named
  // prompt or tool by importing it from @leadbay/mcp / @leadbay/core at runtime. The
  // freshness test in packages/mcp/test/audit reads these snapshots and re-renders to
  // compare. Drift approval re-captures the current live body.
  // For v1 we keep this stub: the eng-review IRON RULE is implemented as a vitest test
  // (see packages/mcp/test/audit/pre-migration-snapshot.test.ts) which manages the
  // snapshot files directly through `vitest -u`. This CLI command is reserved for
  // when we later snapshot the assembled .md.tmpl body instead of the rendered string.
  mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  const logPath = join(SNAPSHOTS_DIR, ".drift-log");
  const entry = `${new Date().toISOString()}  ${name}  (approve-drift CLI invoked; run 'vitest -u' to update the actual snapshot)\n`;
  writeFileSync(logPath, (existsSync(logPath) ? readFileSync(logPath, "utf8") : "") + entry, "utf8");
  console.log(`[forge] drift-log entry written for "${name}". Run vitest -u to actually update the snapshot file.`);
}

function main(): void {
  const { mode, positional } = parseArgs(process.argv);
  try {
    switch (mode) {
      case "build":
        cmdBuild();
        break;
      case "check":
        cmdCheck();
        break;
      case "approve-drift":
        cmdApproveDrift(positional[0]);
        break;
    }
  } catch (err) {
    console.error(`[forge] ERROR: ${(err as Error).message}`);
    process.exit(1);
  }
}

main();
