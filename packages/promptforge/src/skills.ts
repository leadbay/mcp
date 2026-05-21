import type { AssembledArtifact } from "./assembler.js";
import type { PromptArgument } from "./frontmatter.js";

/**
 * Emit one Claude Code skill per prompt.
 *
 * Claude Code skills auto-trigger on description match; they have no
 * structured argument system. So a skill body is the prompt body with
 * every `{{arg:NAME}}` placeholder rewritten in-place as a natural-language
 * extraction instruction the agent reads and follows.
 *
 * Source-of-truth stays the same .md.tmpl that drives the MCP prompt — one
 * source, two emitters. This module owns the prompt-body → skill-body
 * transformation. The MCP renderer's value-substitution logic
 * (packages/mcp/src/prompts.ts) is not duplicated here; per-arg-suffix
 * derivation knowledge lives in DERIVED_HINTS below for the small fixed
 * set of derived placeholders the current six prompts use.
 */

const ARG_PATTERN = /\{\{arg:([a-z_][a-z0-9_]*)\}\}/g;

/**
 * Per-suffix hints for derived placeholders (`<argname>_<suffix>`).
 *
 * Each entry returns the inline natural-language replacement given the base
 * arg's frontmatter description. Keep these in lock-step with the runtime
 * `substitutePlaceholders` calls in packages/mcp/src/prompts.ts.
 *
 * Unknown suffixes fall through to a generic phrasing ("the value derived
 * from {base}"); the test suite catches new derived placeholders so we
 * notice when a prompt author adds one without thinking about skills.
 */
const DERIVED_HINTS: Record<string, (baseDescription: string) => string> = {
  paren: (d) =>
    `<if the user supplied this argument, render the short parenthetical or inline clause derived from it; otherwise empty. Source: ${d}>`,
  block: (d) =>
    `<if the user supplied this argument, render the short block derived from it; otherwise empty. Source: ${d}>`,
  dash: (d) =>
    `<if the user supplied this argument, render the dash-prefixed phrase derived from it; otherwise empty. Source: ${d}>`,
  or_default: (d) =>
    `<the user-supplied value if any; otherwise a sensible default. Source: ${d}>`,
};

function trimDescription(arg: PromptArgument): string {
  return arg.description.replace(/\s+/g, " ").trim();
}

function fullInstruction(arg: PromptArgument): string {
  const desc = trimDescription(arg);
  if (arg.required) {
    return `<${desc} If not provided in the user's most recent message, ask once before proceeding.>`;
  }
  return `<${desc} Optional.>`;
}

function backReference(name: string): string {
  return `<the ${name} (as extracted above)>`;
}

function replacePlaceholder(
  placeholder: string,
  declared: Map<string, PromptArgument>,
  seen: Set<string>,
): string {
  const isFirst = !seen.has(placeholder);
  seen.add(placeholder);

  const direct = declared.get(placeholder);
  if (direct) return isFirst ? fullInstruction(direct) : backReference(placeholder);

  // Derived placeholder: try to find a base arg whose name is a prefix.
  for (const [argName, arg] of declared) {
    if (placeholder.startsWith(`${argName}_`)) {
      const suffix = placeholder.slice(argName.length + 1);
      if (!isFirst) return backReference(placeholder);
      const hint = DERIVED_HINTS[suffix];
      const base = trimDescription(arg);
      if (hint) return hint(base);
      return `<the value derived from "${argName}" (${suffix}). Source: ${base}>`;
    }
  }
  // Shouldn't reach here — assembler's validateArgs already rejected
  // unknown placeholders. Defensive fall-through.
  return `<${placeholder}>`;
}

/**
 * Render the skill body: prompt body with placeholders rewritten as
 * natural-language extraction instructions. First occurrence of each
 * placeholder gets the full instruction; subsequent occurrences get a
 * terse back-reference so calls like
 * `tool({lead_id: '<the lead_id (as extracted above)>'})` stay readable.
 */
function renderSkillBody(artifact: AssembledArtifact): string {
  const declared = new Map<string, PromptArgument>();
  for (const arg of artifact.frontmatter.arguments ?? []) {
    declared.set(arg.name, arg);
  }
  const seen = new Set<string>();
  return artifact.body.replace(ARG_PATTERN, (_match, name: string) =>
    replacePlaceholder(name, declared, seen),
  );
}

function escapeYamlScalar(s: string): string {
  // Single-line YAML scalar: collapse whitespace, escape only the double quote.
  const collapsed = s.replace(/\s+/g, " ").trim();
  return collapsed.replace(/"/g, '\\"');
}

/**
 * Build the SKILL.md content for a single prompt artifact.
 *
 * Format:
 *   ---
 *   name: <prompt name>
 *   description: <short_description (single line, includes trigger phrasing)>
 *   ---
 *
 *   <skill body — prompt body with {{arg:NAME}} rewritten>
 */
export function buildSkillMarkdown(artifact: AssembledArtifact): string {
  const { name, short_description } = artifact.frontmatter;
  const description = escapeYamlScalar(short_description);
  const body = renderSkillBody(artifact).replace(/\s+$/, "");
  return `---\nname: ${name}\ndescription: "${description}"\n---\n\n${body}\n`;
}

export interface SkillFile {
  name: string;
  relativePath: string; // e.g. "leadbay_daily_check_in/SKILL.md"
  content: string;
}

/**
 * Compute the full set of skill files (path + content) for all prompt
 * artifacts. Pure — does not touch disk. Caller is responsible for
 * comparing against disk (cmdCheck) or writing (cmdBuild).
 */
export function buildSkillFiles(artifacts: AssembledArtifact[]): SkillFile[] {
  return artifacts.map((a) => ({
    name: a.frontmatter.name,
    relativePath: `${a.frontmatter.name}/SKILL.md`,
    content: buildSkillMarkdown(a),
  }));
}
