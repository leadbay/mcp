/**
 * Tool-routing classifier eval.
 *
 * For each fixture: feed the intent to Sonnet with the full Leadbay tool
 * catalog bound (Anthropic native tool-use, max_tokens budgeted). Intercept
 * the FIRST tool_use block. Assert name === expected_tool. Assert no
 * forbidden_tools fire as the first call.
 *
 * Why this is light: we run the model exactly once per fixture, with no
 * follow-up turn — we don't care what happens after the routing decision.
 * Cost ~$0.003/fixture × ~70 fixtures ≈ ~$0.20/full run.
 *
 * Skip by default; runs only when EVAL=1 and the touchfile selection
 * matches `tool-routing` (any change under packages/core/src/{tools,composite}/
 * or the tool-descriptions sources).
 */
import { describe, it, expect } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import {
  compositeReadTools,
  compositeWriteTools,
  granularReadTools,
  granularWriteTools,
  type Tool,
} from "@leadbay/core";
import { ROUTING_FIXTURES } from "./routing-fixtures.js";
import { describeIfSelected, selectTouchedKeys } from "../helpers/touchfiles.js";

const ROUTING_MODEL = "claude-sonnet-4-6";

function buildToolList(): Array<{ name: string; description: string; input_schema: Anthropic.Messages.Tool["input_schema"] }> {
  const seen = new Set<string>();
  const out: Tool[] = [];
  for (const t of [
    ...compositeReadTools,
    ...compositeWriteTools,
    ...granularReadTools,
    ...granularWriteTools,
  ]) {
    if (seen.has(t.name)) continue;
    seen.add(t.name);
    out.push(t);
  }
  return out.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Messages.Tool["input_schema"],
  }));
}

const mode = describeIfSelected("tool-routing", selectTouchedKeys());

const hasApiKey = !!process.env.ANTHROPIC_API_KEY;

describe.skipIf(mode === "skip" || !hasApiKey)("eval: tool-routing classifier", () => {
  const tools = buildToolList();
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" });

  // Each fixture is its own test — vitest reports each pass/fail
  // individually, which makes it easy to see exactly which routing
  // decisions regressed.
  for (const fixture of ROUTING_FIXTURES) {
    it(`routes "${fixture.intent.slice(0, 60)}..." → ${fixture.expected_tool}`, async () => {
      const response = await client.messages.create({
        model: ROUTING_MODEL,
        max_tokens: 256,
        tools,
        tool_choice: { type: "auto" },
        messages: [{ role: "user", content: fixture.intent }],
      });

      const firstToolUse = response.content.find(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
      );
      expect(firstToolUse, `expected a tool_use block; got stop_reason=${response.stop_reason}`).toBeDefined();
      const observed = firstToolUse!.name;

      // Hard assertion: must match expected_tool.
      expect(observed).toBe(fixture.expected_tool);

      // Forbidden-tools check (asymmetric signal: forbidden firing is a stronger fail).
      for (const forbidden of fixture.forbidden_tools ?? []) {
        expect(observed, `forbidden tool "${forbidden}" was the first choice`).not.toBe(forbidden);
      }
    }, 30_000);
  }
});
