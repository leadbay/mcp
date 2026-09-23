// `{{render}}` — mark the part of a description that tells the agent how to
// PRESENT the answer, so it ships with the answer instead of with the tool.
//
//   {{render}}
//   {{include:rendering/pull-leads-table}}
//   {{include:linking/contact-linkedin}}
//   {{/render}}
//
// The marked region is cut out of the emitted description and emitted instead
// into `render-blocks.generated.ts`, keyed by tool name. Two things then carry
// it at runtime: every result of that tool gets the one-line recipe from the
// template's `rendering_hint`, and `leadbay_render_guide` returns the full
// block on demand.
//
// Why move it. Claude Code truncates every MCP tool description at 2,048
// characters (its docs, and `j_=2048` in the 2.1.247 binary). A rendering
// algorithm that sits past that point is never read by the model, so the table
// it describes is never rendered. Measured on 2026-09-18: 75% of our
// description characters sat past the cut, and the rendering block survived it
// in 4 of the 21 tools that carry one.
//
// Same shape as `{{commerce}}` in commerce.ts, and it composes with it: a
// `{{commerce}}` block inside a `{{render}}` region is stripped from the
// commerce-free variant of the render block, exactly as it is from the
// commerce-free description. Five rendering / next-steps snippets carry one.

const TAG = "render";
const OPEN = new RegExp(`\\{\\{${TAG}\\}\\}`, "g");
const CLOSE = new RegExp(`\\{\\{/${TAG}\\}\\}`, "g");
const ANY_MARKER = new RegExp(`\\{\\{/?${TAG}\\}\\}`, "g");
// A region takes the blank line that separated it from the prose above, so the
// description reads as though the block had never been written.
const REGION = new RegExp(`\\n*\\{\\{${TAG}\\}\\}\\r?\\n?([\\s\\S]*?)\\{\\{/${TAG}\\}\\}\\r?\\n?`, "g");

export interface SplitRender {
  /** The description with every `{{render}}` region removed. */
  description: string;
  /** The regions, joined in source order. Empty string when there are none. */
  renderBlock: string;
}

export function hasRenderRegion(body: string): boolean {
  OPEN.lastIndex = 0;
  return OPEN.test(body);
}

/**
 * Reject a template whose markers do not pair up or nest. Either would leak a
 * literal `{{render}}` into a shipped description, and nothing downstream
 * catches that.
 */
export function validateRenderMarkers(body: string): string | null {
  const open = (body.match(OPEN) ?? []).length;
  const close = (body.match(CLOSE) ?? []).length;
  if (open !== close) {
    return `unbalanced {{${TAG}}} markers: ${open} opening, ${close} closing`;
  }
  const { description, renderBlock } = splitRenderRegion(body);
  const leaked = `${description}\n${renderBlock}`.match(ANY_MARKER);
  if (leaked) {
    return `{{${TAG}}} markers survive the split (nested pairs?): ${leaked[0]}`;
  }
  return null;
}

export function splitRenderRegion(body: string): SplitRender {
  if (!hasRenderRegion(body)) return { description: body, renderBlock: "" };
  const blocks: string[] = [];
  const description = body.replace(REGION, (_match, inner: string) => {
    blocks.push(inner.trim());
    return "\n\n";
  });
  return {
    description: description.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n",
    renderBlock: blocks.join("\n\n").trim(),
  };
}
