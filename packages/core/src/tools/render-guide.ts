import type { LeadbayClient } from "../client.js";
import type { Tool } from "../types.js";
import { leadbay_render_guide as RENDER_GUIDE_DESCRIPTION } from "../tool-descriptions.generated.js";
import { RENDER_BLOCKS, NO_COMMERCE_RENDER_BLOCKS } from "../render-blocks.generated.js";

// The presentation half of a tool description, served on demand.
//
// `{{render}}` in a template cuts the rendering algorithm out of the
// description and into render-blocks.generated.ts. Every result of that tool
// then carries the one-line recipe (RENDER_RECIPES, attached by the MCP
// server) plus `render.guide`, the tool name to ask for here when the agent
// wants the full algorithm: the score-bar computation, the column rules, the
// link priorities, the fallback layouts.
//
// Why it is a tool and not description text: Claude Code truncates every MCP
// tool description at 2,048 characters, so a rendering block further down was
// read by nobody. A tool result is not truncated that way, and a host caches
// this answer for the rest of the session.
//
// Makes no backend call and mutates nothing. Granular-shaped (single lookup,
// no orchestration), so it stays out of COMPOSITE_FILE_TOOL_NAMES and carries
// no `_triggered_by` mandate: fetching a layout is not acting on a user
// sentence.
//
// Commerce: the ChatGPT surface must not receive prose that promotes a
// purchase, so a block whose template marked `{{commerce}}` is served from
// NO_COMMERCE_RENDER_BLOCKS there. `client.commerce` is set by buildServer per
// route (`/chatgpt/mcp` sets it false), the same switch the descriptions use.

export interface RenderGuideParams {
  tool?: string;
}

export interface RenderGuideResult {
  tool: string;
  guide: string | null;
  available: string[];
  hint?: string;
}

export const renderGuide: Tool<RenderGuideParams, RenderGuideResult> = {
  name: "leadbay_render_guide",
  description: RENDER_GUIDE_DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      tool: {
        type: "string",
        description:
          "The Leadbay tool whose layout you are about to render, e.g. `leadbay_pull_leads`. Take it from `render.guide` on the result you are holding. Omit to list the tools that have a guide.",
      },
    },
    additionalProperties: false,
  },
  annotations: {
    title: "Leadbay: how to lay out a result",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  execute: async (client: LeadbayClient, params: RenderGuideParams = {}) => {
    const blocks = client.commerce === false ? { ...RENDER_BLOCKS, ...NO_COMMERCE_RENDER_BLOCKS } : RENDER_BLOCKS;
    const available = Object.keys(RENDER_BLOCKS).sort();
    const asked = (params.tool ?? "").trim();
    if (!asked) {
      return {
        tool: "",
        guide: null,
        available,
        hint: "Pass one of `available` as `tool` to get its layout.",
      };
    }
    // Accept the bare stem too: a result carries `render.guide: "pull_leads"`
    // in some tools and the full name in others, and an agent that retypes it
    // should not get an empty answer over a prefix.
    const name = asked.startsWith("leadbay_") ? asked : `leadbay_${asked}`;
    const guide = blocks[name];
    if (!guide) {
      return {
        tool: name,
        guide: null,
        available,
        hint: `No layout guide for ${name}. Call leadbay_render_guide with no arguments to see the tools that have one; otherwise render this result as ordinary markdown, one row per item, names linked.`,
      };
    }
    return { tool: name, guide, available };
  },
};
