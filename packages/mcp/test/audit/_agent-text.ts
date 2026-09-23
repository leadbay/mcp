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
 * Helper, not a test file.
 */
import { RENDER_BLOCKS, NO_COMMERCE_RENDER_BLOCKS } from "@leadbay/core";

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
