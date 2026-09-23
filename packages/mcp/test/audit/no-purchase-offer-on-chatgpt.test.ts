/**
 * Audit: the commerce-free surface never offers, displays or names a purchase.
 *
 * `/chatgpt/mcp` drops `leadbay_create_topup_link` and
 * `leadbay_open_billing_portal` and serves NO_COMMERCE_TOOL_DESCRIPTIONS, which
 * deletes every `{{commerce}}` block. That was believed to be the whole story.
 * It was not: an adversarial re-read on 2026-09-22 found fifteen surviving
 * mentions, because five tools had no `{{commerce}}` marker at all —
 * `leadbay_extend_lens` told the agent to render "(3) upgrade plan (TIER1=150,
 * TIER2=1000)" in a choice widget, `leadbay_enrich_titles`,
 * `leadbay_enrich_contacts` and `leadbay_bulk_enrich_status` told it to "offer
 * the wait-or-top-up choice", and the shared quota-windows renderer told it to
 * print a dollar top-up balance.
 *
 * OpenAI's plugin guidelines: "Plugins must not display subscription plans,
 * initiate new subscriptions, or promote upgrades." Worse, the offers named a
 * tool that does not exist on that surface, so the agent would promise
 * something it cannot do.
 *
 * What stays allowed, and why the patterns below are written narrowly:
 * recognising a purchase the user made elsewhere ("I topped up" → re-check
 * quota and retry) is explicitly permitted, and so is telling the agent NOT to
 * gate on a credit counter.
 */
import { describe, it, expect } from "vitest";
import {
  compositeReadTools,
  compositeWriteTools,
  NO_COMMERCE_TOOL_DESCRIPTIONS,
  type Tool,
} from "@leadbay/core";

const COMMERCE_TOOLS = new Set([
  "leadbay_create_topup_link",
  "leadbay_open_billing_portal",
]);

/** The catalogue `/chatgpt/mcp` serves, with the descriptions it serves. */
function commerceFreeSurface(): Array<{ name: string; description: string }> {
  const seen = new Map<string, Tool>();
  for (const t of [...compositeReadTools, ...compositeWriteTools]) {
    if (seen.has(t.name) || COMMERCE_TOOLS.has(t.name)) continue;
    seen.set(t.name, t);
  }
  return [...seen.values()].map((t) => ({
    name: t.name,
    description: NO_COMMERCE_TOOL_DESCRIPTIONS[t.name] ?? t.description,
  }));
}

const FORBIDDEN: Array<[RegExp, string]> = [
  [/leadbay_create_topup_link/, "names a tool this surface does not register"],
  [/leadbay_open_billing_portal/, "names a tool this surface does not register"],
  [/wait-or-top-up/i, "offers a purchase as one of two ways forward"],
  [/top[- ]?up link/i, "offers a checkout link"],
  [/offer (the )?top[- ]?up/i, "offers a purchase"],
  [/upgrade plan/i, "promotes a plan upgrade"],
  [/\bTIER[12]\s*=/i, "displays subscription plan limits"],
  [/Top-up: \$/, "displays a purchased credit balance"],
];

describe("audit: no purchase offer on the commerce-free surface", () => {
  it("no served description offers, displays or names a purchase", () => {
    const offenders: string[] = [];
    for (const { name, description } of commerceFreeSurface()) {
      for (const [re, why] of FORBIDDEN) {
        const m = description.match(re);
        if (m) offenders.push(`${name}: "${m[0]}" — ${why}`);
      }
    }
    expect(
      offenders,
      "Wrap the offer in {{commerce}} … {{/commerce}} in the template so the commerce-free build deletes it.",
    ).toEqual([]);
  });

  it("the default surface still sells exactly as hard as before", () => {
    // The gate deletes; it never softens. So every phrase banned above must
    // still be reachable somewhere on the Claude surface.
    const all = [...compositeReadTools, ...compositeWriteTools]
      .map((t) => t.description)
      .join("\n");
    for (const phrase of ["wait-or-top-up", "upgrade plan", "leadbay_create_topup_link"]) {
      expect(all, `${phrase} vanished from the default surface too`).toContain(phrase);
    }
  });
});
