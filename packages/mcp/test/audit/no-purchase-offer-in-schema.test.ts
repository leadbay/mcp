/**
 * Audit: no parameter or result field offers a purchase on the ChatGPT surface.
 *
 * `no-purchase-offer-on-chatgpt.test.ts` guards the tool DESCRIPTIONS, and it
 * works: `{{commerce}}` deletes the offer and `NO_COMMERCE_TOOL_DESCRIPTIONS`
 * is what `/chatgpt/mcp` serves. But `buildServer` swaps only that string —
 * `packages/mcp/src/server.ts:859-862`. `inputSchema` and `outputSchema` go out
 * byte-for-byte identical on both surfaces, so a sentence on a field is text
 * the commerce gate cannot reach, however complete the gate looks.
 *
 * Found 2026-09-25 while auditing PRs #279-#282, which moved 12,307 characters
 * of rules onto schema fields. The move did not introduce the leak — it was
 * already there — but it made the blind spot worth closing before more rules
 * land on fields.
 *
 * The live one: `leadbay_scan_portfolio_signals`'s `quota_exceeded` field ended
 * "Offer wait-for-reset OR top-up", which the description audit's
 * `/wait-or-top-up/` pattern does not match and would not have read anyway.
 *
 * New file — does not modify no-purchase-offer-on-chatgpt.test.ts.
 */
import { describe, it, expect } from "vitest";
import {
  compositeReadTools,
  compositeWriteTools,
  granularReadTools,
  granularWriteTools,
  type Tool,
} from "@leadbay/core";
import { schemaText } from "./_agent-text.js";

/** Dropped from the catalogue on /chatgpt/mcp — server.ts COMMERCE_TOOL_NAMES. */
const COMMERCE_TOOLS = new Set([
  "leadbay_create_topup_link",
  "leadbay_open_billing_portal",
]);

/**
 * Every tool that can be served on /chatgpt/mcp.
 *
 * Granular tools are included: http-server.ts reads LEADBAY_MCP_ADVANCED from
 * the environment, so the same deployment that serves ChatGPT can register
 * them. None of them sells today, and the audit is what keeps it that way.
 */
function commerceFreeSurface(): Tool[] {
  const seen = new Map<string, Tool>();
  for (const t of [
    ...compositeReadTools,
    ...compositeWriteTools,
    ...granularReadTools,
    ...granularWriteTools,
  ]) {
    if (seen.has(t.name) || COMMERCE_TOOLS.has(t.name)) continue;
    seen.set(t.name, t);
  }
  return [...seen.values()];
}

/**
 * Written to catch an OFFER, in any word order, not every mention of the word.
 * `account_status`'s `quota` field has to be able to name the wire key `topup`,
 * and a tool has to be able to say a purchase made elsewhere already landed.
 */
const FORBIDDEN: Array<[RegExp, string]> = [
  [/\boffer\b[^.]{0,40}\btop[- ]?up\b/i, "tells the model to offer a purchase"],
  [/\btop[- ]?up\b[^.]{0,40}\boffer\b/i, "tells the model to offer a purchase"],
  [/\bupgrade (your |the )?plan\b/i, "promotes a plan upgrade"],
  [/\bTIER[12]\s*=/i, "displays subscription plan limits"],
  [/leadbay_create_topup_link/, "names a tool this surface does not register"],
  [/leadbay_open_billing_portal/, "names a tool this surface does not register"],
  [/\btop[- ]?up link\b/i, "offers a checkout link"],
];

describe("audit: no purchase offer on a schema field", () => {
  it("no parameter or result field sells on the commerce-free surface", () => {
    const offenders: string[] = [];
    for (const tool of commerceFreeSurface()) {
      const text = schemaText(tool);
      for (const [re, why] of FORBIDDEN) {
        const m = text.match(re);
        if (m) offenders.push(`${tool.name}: "${m[0]}" — ${why}`);
      }
    }
    expect(
      offenders,
      "A schema field is served verbatim to ChatGPT; {{commerce}} cannot reach it. " +
        "Move the offer into the tool description and wrap it there.",
    ).toEqual([]);
  });

});
