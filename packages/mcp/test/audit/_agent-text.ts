/**
 * What the agent actually reads for a tool.
 *
 * promptforge's `{{render}}` marker moved every rendering recipe and NEXT
 * STEPS menu out of the tool descriptions and onto the result, because Claude
 * Code truncates a description at 2,048 characters and those blocks sat past
 * the cut. The rules did not change; the channel did.
 *
 * Audits that assert "this rule reaches the agent" therefore have to read both
 * channels. Audits that assert something about the DESCRIPTION specifically —
 * its size, its first 1,100 characters, its routing header — must keep reading
 * the description alone.
 *
 * There is a THIRD channel, and it was unguarded until 2026-09-25: the
 * `description` on every inputSchema / outputSchema property. A host sends
 * those to the model with the tool, and PRs #279-#282 moved 12,307 characters
 * of rules onto them — every one of those rules sat outside every audit that
 * uses this helper. Worse, `buildServer` swaps only the description string for
 * the commerce-free surface (server.ts:859-862), so schema text is served
 * VERBATIM to ChatGPT: a purchase offer there bypasses the gate entirely, which
 * is how `leadbay_scan_portfolio_signals` shipped one.
 *
 * `schemaText` reads that channel. The commerce audit is the one with a proven
 * live leak, so it is covered first, in its own new file. The other six audits
 * on this helper still read descriptions only; each needs its own pass to
 * decide whether the rule it guards can even live on a field.
 *
 * Helper, not a test file.
 */
import { RENDER_BLOCKS, NO_COMMERCE_RENDER_BLOCKS, type Tool } from "@leadbay/core";

/** Every `description` on a JSON-schema node, depth-first. */
function schemaDescriptions(node: unknown, out: string[] = []): string[] {
  if (!node || typeof node !== "object") return out;
  const n = node as { description?: unknown; properties?: Record<string, unknown>; items?: unknown };
  if (typeof n.description === "string") out.push(n.description);
  for (const child of Object.values(n.properties ?? {})) schemaDescriptions(child, out);
  if (n.items) schemaDescriptions(n.items, out);
  return out;
}

/** A tool's parameter and result-field text — the third thing the model reads. */
export function schemaText(tool: Pick<Tool, "inputSchema" | "outputSchema">): string {
  return [
    ...schemaDescriptions(tool.inputSchema),
    ...schemaDescriptions((tool as { outputSchema?: unknown }).outputSchema),
  ].join("\n");
}

/** One tool: its description plus its render block. */
export function agentText(name: string, description: string, commerce = true): string {
  const block = commerce
    ? RENDER_BLOCKS[name]
    : (NO_COMMERCE_RENDER_BLOCKS[name] ?? RENDER_BLOCKS[name]);
  return block ? `${description}\n\n${block}` : description;
}

/** Every tool in a generated-descriptions map, each with its render block appended. */
export function withRenderBlocks(
  descriptions: Record<string, string>,
  commerce = true,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, description] of Object.entries(descriptions)) {
    if (typeof description !== "string") continue;
    out[name] = agentText(name, description, commerce);
  }
  return out;
}
