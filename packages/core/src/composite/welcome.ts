import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext } from "../types.js";
import { readSearchConfiguration } from "./account-status.js";
import { isFirstRun } from "./_first-run.js";

import { leadbay_welcome as WELCOME_DESCRIPTION } from "../tool-descriptions.generated.js";

// The welcome board's data: who the user is, what Leadbay's AI learned about
// their business, and whether this looks like their first steps. The board
// (components/src/templates/onboarding) renders it — as the MCP Apps view on
// the apps surfaces, as a published artifact on Claude — and the agent
// renders the same fields as markdown where neither is available.
//
// The "what our AI learned" card is the web app's welcome dialog (frontend
// features/Tour/LeadpassCard): intent signals, qualification questions and
// the ideal buyer profile, read through account_status's own reader so the two
// tools can never disagree about the account.

/** The web app's "Join the next live onboarding" link (frontend
 *  TourComponent). A free group session, not a sale. */
export const LIVE_ONBOARDING_URL = "https://luma.com/workshopleadbay";

/** What the agent offers as first actions when no board renders. Each `say`
 *  is a phrase another tool's routing already answers; the last one starts
 *  the guided tour (leadbay_getting_started). */
export const WELCOME_STARTERS: ReadonlyArray<{ label: string; say: string }> = [
  { label: "Today's leads", say: "Show me today's leads" },
  { label: "Who to follow up", say: "Which leads should I follow up with?" },
  { label: "Draft a first email", say: "Draft a first email to my top lead" },
  { label: "Take the 2-minute tour", say: "Walk me through Leadbay" },
];

function firstName(name: string | undefined): string | null {
  const first = (name ?? "").trim().split(/\s+/)[0];
  return first ? first : null;
}

export const welcome: Tool<Record<string, never>> = {
  name: "leadbay_welcome",
  annotations: {
    title: "Welcome board",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  description: WELCOME_DESCRIPTION,
  outputSchema: {
    type: "object",
    properties: {
      user: {
        type: "object",
        properties: {
          name: { type: ["string", "null"] },
          first_name: { type: ["string", "null"], description: "Greet the user with this." },
        },
      },
      organization: {
        type: "object",
        properties: {
          name: { type: "string" },
          computing_intelligence: {
            type: "boolean",
            description: "True while Leadbay is still scoring the account's first leads.",
          },
        },
      },
      leadpass: {
        type: "object",
        description:
          "What Leadbay's AI learned about the business — the web app's welcome card. A null field is unset or unreadable: leave it out, never call it missing.",
        properties: {
          purchase_intent_tags: { type: ["array", "null"], items: { type: "string" } },
          qualification_questions: { type: ["array", "null"], items: { type: "string" } },
          ideal_buyer_profile: {
            type: ["object", "null"],
            properties: {
              summary: { type: "string" },
              key_characteristics: { type: "array", items: { type: "string" } },
              anti_patterns: { type: "array", items: { type: "string" } },
            },
          },
          targeting_prompt: { type: ["string", "null"] },
        },
      },
      first_run: {
        type: "boolean",
        description: "True when this looks like the user's first steps in Leadbay (a guess — see the description).",
      },
      board: {
        type: "object",
        description: "The finished board to publish on Claude: leadbay_get_artifact_runtime({template}).",
        properties: { template: { type: "string" } },
      },
      starters: {
        type: "array",
        description: "First actions to offer when no board renders: {label, say}.",
        items: { type: "object" },
      },
      live_onboarding_url: { type: "string" },
      _meta: { type: "object", description: "Server-injected notices, when present." },
    },
    required: ["user", "organization", "leadpass", "first_run", "board", "starters"],
  },
  write: false,
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  execute: async (client: LeadbayClient, _params, ctx?: ToolContext) => {
    const me = await client.resolveMe();
    const leadpass = await readSearchConfiguration(client, me.organization.id, ctx);
    return {
      user: { name: me.name ?? null, first_name: firstName(me.name) },
      organization: {
        name: me.organization.name,
        computing_intelligence: me.organization.computing_intelligence ?? false,
      },
      leadpass,
      first_run: isFirstRun(me),
      board: { template: "onboarding" },
      starters: WELCOME_STARTERS.map((s) => ({ ...s })),
      live_onboarding_url: LIVE_ONBOARDING_URL,
    };
  },
};
