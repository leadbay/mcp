// `{{claude}}` — prose written for Claude's own rendering and widgets.
//
// The rendering recipes (snippets/rendering/), the NEXT STEPS tables
// (snippets/next-steps/), the link patterns (snippets/linking/), the host-widget
// table (snippets/gates/builtin-widgets)
// and the `## RENDER (quick)` header tell the agent exactly how to lay out a
// result and which widget to call next. ChatGPT's own tool-call check rates
// that text "danger HIGH": "Tool documentation prescribes classifier handling
// and output behavior, including mandatory rendering and next-step widget
// instructions" (2026-10-24, on every Leadbay approval card). So /chatgpt/mcp
// is served without it.
//
// Nobody writes this marker by hand. snippets.ts wraps every include of those
// snippets, and assembler.ts wraps the RENDER (quick) block. Every rendering
// except /chatgpt/mcp keeps the blocks, byte-for-byte. Same delete-only rule
// as `{{commerce}}` — see markers.ts.

import { surfaceMarker, type MarkerMode } from "./markers.js";

const claude = surfaceMarker("claude");

/** Snippets that are Claude rendering prose. Their includes get wrapped. */
export function isClaudeRenderingSnippet(name: string): boolean {
  return (
    name.startsWith("rendering/") ||
    name.startsWith("next-steps/") ||
    name.startsWith("linking/") ||
    name === "gates/builtin-widgets"
  );
}

/** Own-line markers around `content`. Removing them gives back `content` exactly. */
export function wrapClaude(content: string): string {
  return `{{claude}}\n${content}\n{{/claude}}`;
}

export function hasClaudeMarkers(body: string): boolean {
  return claude.has(body);
}

export function validateClaudeMarkers(body: string): string | null {
  return claude.validate(body);
}

/** "with" keeps the blocks (every surface but ChatGPT); "without" deletes them. */
export function renderClaude(body: string, mode: MarkerMode): string {
  const out = claude.render(body, mode);
  if (mode === "with" || out === body) return out;
  // A deleted section often stood between two `---` rules, and between blank
  // lines. Collapse what that leaves behind: still deletion only.
  return out
    .replace(/\n---\n(?:\s*\n---\n)+/g, "\n---\n")
    .replace(/(?:\s*\n---[ \t]*)+\s*$/, "\n")
    .replace(/\n{3,}/g, "\n\n");
}
