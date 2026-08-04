import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext } from "../types.js";

import { leadbay_getting_started as GETTING_STARTED_DESCRIPTION } from "../tool-descriptions.generated.js";

// leadbay_getting_started returns the guided first-run walkthrough (issue
// leadbay/product#3952): a short script the agent drives so a brand-new user
// learns Leadbay by DOING. Three gates, each carrying exactly ONE option, each
// click running a real Leadbay call. Makes no backend call and mutates nothing
// — the manifest is static, version-locked content.
//
// STATELESS BY DESIGN — there is no `step` argument. The agent fetches the
// whole manifest once and drives the gates from the conversation it already
// has. A `{step: 1|2|3}` cursor was rejected for three reasons:
//   1. The MCP server is stateless per call, so a cursor makes the AGENT the
//      state-holder — a second, less reliable copy of what the conversation
//      already knows. Miscount and the user gets step 2 twice.
//   2. `_triggered_by` must be the verbatim user slice. On a click-through the
//      "message" is a widget selection, so a per-step tool would emit
//      provenance that is the agent's own option labels, three times over.
//   3. Precedent: leadbay_artifact_kit is the existing "hand the agent a
//      script, not data" tool — zero input, static content, no orchestration.
//
// Lives in composite/ (user-facing, per CLAUDE.md) so it carries the
// `_triggered_by` mandate — "walk me through Leadbay" is a genuine user
// utterance with real provenance to capture. Registered in compositeReadTools
// so the walkthrough still works on a read-only (LEADBAY_MCP_WRITE=0)
// deployment.

/** One step of the walkthrough. */
export interface WalkthroughStep {
  /** 1-indexed step number. */
  n: number;
  /** The widget's single option label — render verbatim. */
  gate_label: string;
  /** The widget's single option description. */
  gate_description: string;
  /** Tool to call on click, or null when no Leadbay tool applies. */
  calls: string | null;
  /** Literal argument shape to pass to `calls`. */
  args: Record<string, string> | null;
  /** Args that must NEVER be passed, with the reason. */
  forbidden_args?: string[];
  /** Why those args are forbidden — surfaced so the agent can't rationalize past it. */
  spend?: string;
  /** Value to capture from the response and forward to later steps. */
  pin?: string;
  /** Conditional handling the agent must apply to the response. */
  branches?: Array<{ when: string; then: string }>;
  /** Extra handling notes for steps with no tool call. */
  handoff?: string;
}

export interface GettingStartedManifest {
  version: number;
  intro: string;
  one_option_rule: string;
  steps: WalkthroughStep[];
  stop: string;
}

const ONE_OPTION_RULE =
  "Every gate presents exactly ONE option. Not one plus 'Skip'. Not one plus " +
  "'No thanks'. One. A first-run user does not yet know enough to choose " +
  "between options — a menu makes them stall, and one option makes the next " +
  "move obvious. The gate IS the widget: call your host's choice widget with a " +
  "single-option options array, never a prose question. The user's escape " +
  "hatch is TYPING and needs no button — if they type something off-script, " +
  "abandon the walkthrough and serve what they asked.";

const INTRO =
  "Open with 2-3 sentences in plain salesperson language, no jargon: Leadbay " +
  "keeps a LENS (your target audience) and delivers fresh matching companies " +
  "every day. Then say what the next three clicks will do, then fire gate 1. " +
  "No tool call and no widget in this step.";

const STOP =
  "The walkthrough never takes outbound action. Do not draft or send outreach. " +
  "Do not call leadbay_report_outreach. End by waiting for the user.";

export const GETTING_STARTED_MANIFEST: GettingStartedManifest = {
  version: 1,
  intro: INTRO,
  one_option_rule: ONE_OPTION_RULE,
  steps: [
    {
      n: 1,
      gate_label: "Pull today's leads",
      gate_description: "Pull today's leads from your lens.",
      calls: "leadbay_pull_leads",
      args: {},
      pin: "lens.id — pass as an explicit lensId on every later step, so step 2 enriches the same lens the user just saw",
      branches: [
        {
          when: "leads.length > 0",
          then: "Render the canonical pull_leads table, then advance to gate 2.",
        },
        {
          when: "leads.length === 0 && (computing_wishlist || computing_scores)",
          then:
            "The lens is still building — normal on a new account. Say so in the user's terms, then render the tool's own next_steps payload VERBATIM (it carries two options: 'Re-pull in ~30s' / 'Refine audience'). This is the ONE place a gate carries two options, because the server built the payload. On re-pull, wait ~30s and return to gate 1. NEVER say 'no leads found'.",
        },
        {
          when: "leads.length === 0 && !computing_wishlist && !computing_scores",
          then:
            "The lens is genuinely empty or too narrow and next_steps is null. Say so honestly, offer to widen the audience, and end the walkthrough — there is nothing to enrich.",
        },
      ],
    },
    {
      n: 2,
      gate_label: "Enrich top leads",
      gate_description: "See who to contact at the top leads.",
      calls: "leadbay_enrich_titles",
      args: {
        leadIds: "<the lead ids from step 1>",
        lensId: "<the pinned lens id from step 1>",
      },
      forbidden_args: ["titles", "confirm", "email", "phone"],
      spend:
        "NOTHING. Omitting `titles` returns mode:'discover' — the free preview of " +
        "which job titles are available. Passing titles, confirm=true, email=true " +
        "or phone=true launches a PAID reveal. This user has been using Leadbay " +
        "for ninety seconds; never spend their quota to demonstrate a feature. " +
        "After presenting the titles, say plainly that nothing was spent and that " +
        "revealing emails/phones is a separate, paid step they confirm.",
    },
    {
      n: 3,
      gate_label: "Run this every morning",
      gate_description: "Set this up to run automatically every morning.",
      calls: null,
      args: null,
      handoff:
        "Leadbay has no scheduling API and no leadbay_* tool creates a scheduled " +
        "task — that is why `calls` is null here. The gate's option text is " +
        "literal recurring language, which is what lets your host's own " +
        "scheduled-task flow take over. Follow that flow (it asks frequency, then " +
        "time, then confirms) rather than re-asking those questions yourself — two " +
        "competing scheduling flows in one conversation is a defect. Name the task " +
        "concretely, e.g. 'Daily prospecting check-in'. If your host exposes no " +
        "scheduler, say so honestly in one line. Either way: NEVER claim a " +
        "scheduled task was created — only the host can create one.",
    },
  ],
  stop: STOP,
};

export interface GettingStartedParams {
  // No input — the walkthrough is the same for every caller.
}

export const gettingStarted: Tool<GettingStartedParams> = {
  name: "leadbay_getting_started",
  annotations: {
    title: "Guided Leadbay walkthrough",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  description: GETTING_STARTED_DESCRIPTION,
  write: false,
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  // No outputSchema by design — same trade-off as leadbay_artifact_kit:
  // declaring one enrolls the tool in the output-schema-conformance
  // drift-catcher (an existing test file we don't modify). The server still
  // emits the plain-object return as structuredContent.
  execute: async (
    _client: LeadbayClient,
    _params: GettingStartedParams,
    _ctx?: ToolContext,
  ) => {
    return GETTING_STARTED_MANIFEST;
  },
};
