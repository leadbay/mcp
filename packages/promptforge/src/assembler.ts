import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parseTemplate, type Frontmatter, type ParsedTemplate, type Routing, FrontmatterError } from "./frontmatter.js";
import { resolveSnippets } from "./snippets.js";

/**
 * Generate the `## WHEN TO USE` block from a tool's routing
 * frontmatter. Emitted at the head of the description so the agent
 * sees routing BEFORE the body and well within the first ~600 chars
 * (the chunk every host reads even on truncation). See /CLAUDE.md.
 */
function emitRoutingBlock(
  routing: Routing | undefined,
  memoryPointer?: string
): string {
  if (!routing) return "";
  const lines: string[] = ["## WHEN TO USE"];
  if (routing.triggers && routing.triggers.length > 0) {
    const phrases = routing.triggers.map((t) => `"${t}"`).join(", ");
    lines.push(`Trigger phrases: ${phrases}.`);
  }
  if (routing.anti_triggers && routing.anti_triggers.length > 0) {
    const formatted = routing.anti_triggers
      .map((a) => `"${a.phrase}" → \`${a.route_to}\``)
      .join("; ");
    lines.push(`Do NOT use for: ${formatted}.`);
  }
  if (routing.prefer_when) {
    lines.push(`Prefer when: ${routing.prefer_when.trim()}`);
  }
  if (memoryPointer) {
    lines.push(memoryPointer.trim());
  }
  if (routing.examples) {
    const positives = routing.examples.positive ?? [];
    const negatives = routing.examples.negative ?? [];
    if (positives.length > 0) {
      const items = positives.map((s) => `- "${s.trim()}"`).join("\n");
      lines.push(`Examples that SHOULD invoke this tool:\n${items}`);
    }
    if (negatives.length > 0) {
      const items = negatives.map((s) => `- "${s.trim()}"`).join("\n");
      lines.push(`Examples that should NOT invoke this tool (sound similar, route elsewhere):\n${items}`);
    }
  }
  return lines.join("\n\n");
}

/**
 * Generate the `## RENDER (quick)` block from `rendering_hint`. A
 * compact preview of the canonical rendering — full algorithm lives
 * in the detailed RENDERING include below. Stays terse so the
 * combined routing + render hint fits in the first ~600 chars.
 */
function emitRenderHintBlock(hint: string | undefined): string {
  if (!hint) return "";
  return ["## RENDER (quick)", hint.trim()].join("\n\n");
}

/**
 * Prepend the auto-generated header (routing + render hint) to the
 * body. If neither is set, returns the body unchanged so existing
 * templates that don't use the new frontmatter fields are unaffected.
 */
export function applyDescriptionHeader(
  fm: Frontmatter,
  body: string,
  opts: { memoryPointer?: string } = {}
): string {
  const blocks: string[] = [];
  const memoryProtocol =
    fm.memory_protocol ?? (fm.routing ? "enabled" : "disabled");
  const routing = emitRoutingBlock(
    fm.routing,
    memoryProtocol === "enabled" ? opts.memoryPointer : undefined
  );
  if (routing) blocks.push(routing);
  const renderHint = emitRenderHintBlock(fm.rendering_hint);
  if (renderHint) blocks.push(renderHint);
  if (blocks.length === 0) return body;
  return blocks.join("\n\n") + "\n\n---\n\n" + body.replace(/^\s+/, "");
}

export interface AssembledArtifact {
  frontmatter: Frontmatter;
  body: string;
  sourcePath: string;
}

export interface AssembleResult {
  prompts: AssembledArtifact[];
  toolDescriptions: AssembledArtifact[];
}

export interface AssembleOptions {
  root: string;
  registeredToolNames: Set<string>;
}

const ARG_PATTERN = /\{\{arg:([a-z_][a-z0-9_]*)\}\}/g;

export class AssemblyError extends Error {
  constructor(message: string, public readonly sourcePath: string) {
    super(`${sourcePath}: ${message}`);
    this.name = "AssemblyError";
  }
}

function findTemplates(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      findTemplates(path, out);
    } else if (entry.endsWith(".md.tmpl")) {
      out.push(path);
    }
  }
  return out;
}

function validateArgs(parsed: ParsedTemplate, body: string): void {
  const declared = (parsed.frontmatter.arguments ?? []).map((a) => a.name);
  const used = new Set<string>();
  for (const match of body.matchAll(ARG_PATTERN)) {
    used.add(match[1]);
  }
  if (parsed.frontmatter.kind === "tool-description" && (declared.length > 0 || used.size > 0)) {
    throw new AssemblyError(
      `tool-description must not declare arguments or use {{arg:...}}`,
      parsed.sourcePath,
    );
  }
  // Validation rule (lenient — handles conditional/derived placeholders such as
  // `file_paren` that render() computes from the `file` arg): every body
  // placeholder name must match a declared arg name OR start with `<argname>_`.
  // This lets render() inject conditional/wrapping logic without forcing 1:1
  // names between user-facing args and the placeholders inside body prose.
  const orphans: string[] = [];
  for (const placeholder of used) {
    const matched = declared.some(
      (arg) => placeholder === arg || placeholder.startsWith(`${arg}_`),
    );
    if (!matched) orphans.push(placeholder);
  }
  if (orphans.length > 0) {
    throw new AssemblyError(
      `body references {{arg:...}} with no matching frontmatter argument ` +
        `(placeholder must equal an arg name or start with "<argname>_"): ${orphans.join(", ")}`,
      parsed.sourcePath,
    );
  }
  // We deliberately do NOT check "declared but never referenced" — a prompt may
  // accept an arg that influences runtime behavior outside the body string
  // (e.g. validation, dispatch). The body need not literally reference every arg.
}

function validateExpectedCalls(parsed: ParsedTemplate, registered: Set<string>): void {
  const expected = parsed.frontmatter.expected_calls ?? [];
  const unknown = expected.filter((name) => !registered.has(name));
  if (unknown.length > 0) {
    throw new AssemblyError(
      `expected_calls references unknown tool(s): ${unknown.join(", ")}`,
      parsed.sourcePath,
    );
  }
}

function validateMutatingPromptFailureModes(parsed: ParsedTemplate, mutatingToolNames: Set<string>): void {
  if (parsed.frontmatter.kind !== "prompt") return;
  const expected = parsed.frontmatter.expected_calls ?? [];
  const mentionsMutating = expected.some((name) => mutatingToolNames.has(name));
  if (!mentionsMutating) return;
  const fm = parsed.frontmatter.failure_modes ?? [];
  if (fm.length < 3) {
    throw new AssemblyError(
      `prompts that call mutating tools must declare >= 3 failure_modes (found ${fm.length})`,
      parsed.sourcePath,
    );
  }
}

function nameMatchesFile(parsed: ParsedTemplate): void {
  // Sanity: filename should equal the frontmatter.name, allowing two ergonomic
  // shortcuts authors take when naming files:
  //   - the leadbay_ prefix may be omitted in the filename
  //   - underscores in the name may be written as dashes in the filename
  const expected = parsed.frontmatter.name;
  const rel = relative(process.cwd(), parsed.sourcePath);
  const stem = rel.split("/").pop()!.replace(/\.md\.tmpl$/, "");
  const candidates = new Set<string>([
    expected,
    expected.replace(/^leadbay_/, ""),
    expected.replace(/_/g, "-"),
    expected.replace(/^leadbay_/, "").replace(/_/g, "-"),
  ]);
  if (!candidates.has(stem)) {
    throw new AssemblyError(
      `filename "${stem}" does not match frontmatter.name "${expected}" ` +
        `(accepted: ${[...candidates].join(", ")})`,
      parsed.sourcePath,
    );
  }
}

export function assemble(opts: AssembleOptions): AssembleResult {
  const { root, registeredToolNames } = opts;
  const snippetsRoot = join(root, "snippets");
  const promptDir = join(root, "prompts");
  const toolDir = join(root, "tool-descriptions");
  const memoryPointerPath = join(snippetsRoot, "headers", "agent-memory-pointer.md");
  const memoryPointer = existsSync(memoryPointerPath)
    ? readFileSync(memoryPointerPath, "utf8").trim()
    : "";

  // Mutating tools = anything with destructiveHint:true OR readOnlyHint:false in its annotations.
  // For now we pass it as registeredToolNames; calling code may pass a sub-set explicitly later.
  // The simplest signal: a tool whose name starts with leadbay_import_/leadbay_create_/leadbay_set_/
  // leadbay_select_/leadbay_deselect_/leadbay_update_/leadbay_promote_/leadbay_qualify_/
  // leadbay_enrich_/leadbay_clear_/leadbay_pick_/leadbay_dismiss_/leadbay_remove_/leadbay_preview_/
  // leadbay_launch_/leadbay_report_/leadbay_add_/leadbay_adjust_/leadbay_refine_/leadbay_answer_.
  const mutatingPattern = /^leadbay_(import|create|set|select|deselect|update|promote|qualify|enrich|clear|pick|dismiss|remove|preview|launch|report|add|adjust|refine|answer|bulk_|prepare_)/;
  const mutatingToolNames = new Set(
    [...registeredToolNames].filter((n) => mutatingPattern.test(n)),
  );

  const prompts: AssembledArtifact[] = [];
  const toolDescriptions: AssembledArtifact[] = [];

  const allTemplates = [
    ...findTemplates(promptDir).map((p) => ({ path: p, expectedKind: "prompt" as const })),
    ...findTemplates(toolDir).map((p) => ({ path: p, expectedKind: "tool-description" as const })),
  ];

  for (const { path, expectedKind } of allTemplates) {
    const source = readFileSync(path, "utf8");
    const parsed = parseTemplate(source, path);
    if (parsed.frontmatter.kind !== expectedKind) {
      throw new AssemblyError(
        `frontmatter.kind="${parsed.frontmatter.kind}" but file lives in ${expectedKind} directory`,
        path,
      );
    }
    nameMatchesFile(parsed);

    const resolved = resolveSnippets(parsed.body, { snippetsRoot, sourcePath: path });
    validateArgs(parsed, resolved);
    validateExpectedCalls(parsed, registeredToolNames);
    validateMutatingPromptFailureModes(parsed, mutatingToolNames);

    // For tool-descriptions, prepend the auto-generated WHEN TO USE
    // (from `routing`) + RENDER (quick) (from `rendering_hint`)
    // blocks. They live at the very head of the emitted description
    // so the routing/rendering directives land in the first ~600
    // chars even when a host truncates. Prompts (slash-commands) keep
    // their body verbatim — no auto-emitted blocks.
    const finalBody =
      expectedKind === "tool-description"
        ? applyDescriptionHeader(parsed.frontmatter, resolved, { memoryPointer })
        : resolved;

    const artifact: AssembledArtifact = {
      frontmatter: parsed.frontmatter,
      body: finalBody.trimEnd() + "\n",
      sourcePath: path,
    };

    if (expectedKind === "prompt") {
      prompts.push(artifact);
    } else {
      toolDescriptions.push(artifact);
    }
  }

  // Sort alphabetically by name for diff-friendly emit.
  prompts.sort((a, b) => a.frontmatter.name.localeCompare(b.frontmatter.name));
  toolDescriptions.sort((a, b) => a.frontmatter.name.localeCompare(b.frontmatter.name));

  return { prompts, toolDescriptions };
}

export { FrontmatterError };
