/**
 * Audit: the three required MCP tool annotations are present on every
 * registered tool AND match what the tool actually does.
 *
 * Why this file exists: OpenAI rejected Leadbay v0.34.0 with "one or more of
 * your tool's annotations do not appear to match the tool's behavior". At that
 * point every tool in the catalogue carried `openWorldHint: true` — including
 * `leadbay_list_campaigns`, which does one GET against the signed-in user's own
 * workspace — and eight tools that write carried `readOnlyHint: true`.
 *
 * The definitions are OpenAI's (developers.openai.com/plugins/reference
 * #annotations, and the plugin guidelines under "Correct annotation"):
 *
 *   readOnlyHint     the tool only retrieves or computes information and does
 *                    not create, update, delete, or send data outside the
 *                    conversation.
 *   destructiveHint  the tool may delete or overwrite user data.
 *   openWorldHint    the tool accesses the public internet or open-ended
 *                    external entities. "A bounded private account or
 *                    workspace isn't open-world solely because it is
 *                    externally hosted."
 *
 * The last sentence is the one the old catalogue got wrong, so the open-world
 * set is pinned by name here with the reason each one earns it.
 */
import { describe, it, expect } from "vitest";
import {
  compositeReadTools,
  compositeWriteTools,
  granularReadTools,
  granularWriteTools,
  type Tool,
} from "@leadbay/core";

const ALL: Tool[] = [
  ...compositeReadTools,
  ...compositeWriteTools,
  ...granularReadTools,
  ...granularWriteTools,
];

/**
 * The only calls that leave the user's own Leadbay workspace. Everything else
 * talks to api-us / api-fr about records that belong to the signed-in user,
 * which the guidelines explicitly say is NOT open-world.
 */
const OPEN_WORLD: Record<string, string> = {
  leadbay_find_new_leads: "POST /mcp/search — Leadbay discovers companies off the open web",
  leadbay_qualify_leads: "POST /mcp/qualify — web research on the named companies",
  leadbay_bulk_qualify_leads: "POST /leads/selection/web_fetch — AI web research",
  leadbay_qualify_lead: "POST /leads/{id}/web_fetch — AI web research",
  leadbay_import_and_qualify: "fans out /leads/{id}/web_fetch after the import",
  leadbay_enrich_titles: "POST /leads/selection/enrichment/launch — third-party contact-data providers",
  leadbay_enrich_contacts: "orders email/phone from third-party contact-data providers",
  leadbay_launch_bulk_enrichment: "same providers, selection-scoped",
  leadbay_prepare_outreach: "with enrich:true it orders contact details from those providers",
  leadbay_report_friction: "delivers the user's words to Leadbay's PostHog project",
  leadbay_send_feedback: "delivers the user's message to Leadbay's Sentry inbox",
  leadbay_report_artifact_error: "hands a bounded enum + error code to Leadbay's error tracker",
  leadbay_create_topup_link: "returns a Stripe checkout URL",
  leadbay_open_billing_portal: "returns a Stripe billing-portal URL",
};

describe("audit: tool annotations match tool behaviour", () => {
  it("every tool sets readOnlyHint, destructiveHint and openWorldHint explicitly", () => {
    const missing: string[] = [];
    for (const t of ALL) {
      const a = t.annotations;
      for (const key of ["readOnlyHint", "destructiveHint", "openWorldHint"] as const) {
        if (typeof a?.[key] !== "boolean") missing.push(`${t.name}.${key}`);
      }
    }
    expect(
      missing,
      "OpenAI requires an explicit true/false (never null/absent) on all three.",
    ).toEqual([]);
  });

  it("a tool flagged readOnlyHint:true is never a write tool", () => {
    const offenders = ALL.filter((t) => t.annotations?.readOnlyHint && t.write === true).map(
      (t) => t.name,
    );
    expect(offenders).toEqual([]);
  });

  it("a tool flagged readOnlyHint:true is never destructive", () => {
    const offenders = ALL.filter(
      (t) => t.annotations?.readOnlyHint && t.annotations?.destructiveHint,
    ).map((t) => t.name);
    expect(offenders).toEqual([]);
  });

  it("openWorldHint:true is reserved for calls that leave the user's workspace", () => {
    const unexplained = ALL.filter((t) => t.annotations?.openWorldHint)
      .map((t) => t.name)
      .filter((n) => !(n in OPEN_WORLD));
    expect(
      unexplained,
      "Talking to api-us.leadbay.app is not open-world. Add the tool to OPEN_WORLD with the call that earns it, or set the hint false.",
    ).toEqual([]);
  });

  it("every name in the open-world set is still a registered tool", () => {
    const registered = new Set(ALL.map((t) => t.name));
    const stale = Object.keys(OPEN_WORLD).filter((n) => !registered.has(n));
    expect(stale, "OPEN_WORLD names a tool that no longer exists").toEqual([]);
  });

  it("the tools that reach the public web or a paid provider all declare it", () => {
    // The inverse check: these are the calls a reviewer will look for, so a
    // future edit must not quietly drop the hint.
    for (const name of Object.keys(OPEN_WORLD)) {
      const t = ALL.find((x) => x.name === name);
      expect(t, `${name} not registered`).toBeDefined();
      expect(t!.annotations?.openWorldHint, `${name} openWorldHint`).toBe(true);
    }
  });
});
