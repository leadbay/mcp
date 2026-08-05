import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext } from "../types.js";

import { leadbay_getting_started as GETTING_STARTED_DESCRIPTION } from "../tool-descriptions.generated.js";

// leadbay_getting_started returns the guided first-run walkthrough (issue
// leadbay/product#3952): a short script the agent drives so a brand-new user
// learns Leadbay by DOING. Five gates, each carrying ONE forward action plus an
// exit (two options — a lone option degrades to prose on real hosts). Makes
// no backend call and mutates nothing — the manifest is static, version-locked
// content.
//
// Gate 1 (leadbay_account_status) is the tutorial's "you're connected" beat and
// carries two PINNED regressions in its branches: stay silent when quota_error
// is set (WORKFLOWS #30) and never volunteer the lens (WORKFLOWS #31, enforced
// server-side — account-status.ts withholds it unless the trigger text asks).
//
// Two of the five gates delegate to a capability Leadbay does NOT have and the
// HOST usually does (`calls: null`): the CRM push (gate 4) and the recurring
// schedule (gate 5). Leadbay has no CRM integration and no scheduling API, so
// the manifest names the CAPABILITY rather than a third-party tool name and
// lets the agent find its own connector — the same detection the
// connected-outreach-tool table in leadbay_prospecting_overview already uses.
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

/**
 * The gate's widget payload — the SAME shape leadbay_pull_leads returns as
 * `next_steps`, so the agent maps it verbatim into its host widget instead of
 * assembling the call from prose. This is what makes the gate render as a
 * button rather than the model deciding to run the tool straight through.
 *
 * `explain` is the short plain-language sentence the agent says BEFORE firing
 * the widget: a tutorial has to teach what the step does, not just offer it.
 */
export interface GateNextSteps {
  /** The widget's question line. */
  question: string;
  /** Exactly TWO: the action, then the exit. See ONE_OPTION_RULE. */
  options: Array<{ label: string; description: string; kind: string }>;
}

/** One step of the walkthrough. */
export interface WalkthroughStep {
  /** 1-indexed step number. */
  n: number;
  /** The forward action's label — render verbatim. */
  gate_label: string;
  /** The forward action's description. */
  gate_description: string;
  /** What to TELL the user about this step before firing the widget. */
  explain: string;
  /** Widget payload — map into ask_user_input_v0 / AskUserQuestion VERBATIM. */
  next_steps: GateNextSteps;
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

/** One row of the closing cheat-sheet: what the user wants → what they type. */
export interface PhraseCard {
  /** The outcome in the user's language. */
  want: string;
  /** A phrase that actually triggers it — taken from the tool's own routing block. */
  say: string;
}

export interface GettingStartedManifest {
  version: number;
  intro: string;
  one_option_rule: string;
  steps: WalkthroughStep[];
  /**
   * The hand-off. The buttons disappear when the walkthrough ends, so the tour
   * closes by telling the user what to TYPE to get each thing back. Every
   * phrase here is lifted from the corresponding tool's own `routing.triggers`
   * (see packages/promptforge/tool-descriptions/composite/*.md.tmpl) — never
   * invent one, or the tutorial teaches a phrase that doesn't route.
   */
  keep_going: PhraseCard[];
  stop: string;
}

const ONE_OPTION_RULE =
  "Every gate presents exactly ONE way forward, plus a way out — two options, " +
  "never more: the action, and 'I'm done for now'. A first-run user does not " +
  "yet know enough to choose between PATHS; one forward move makes the next " +
  "step obvious, and the click is what teaches them the tool. The exit keeps " +
  "the tour from being a trap, and satisfies the host widget's 2-4 option " +
  "requirement — a lone option is rejected or silently degrades to prose, " +
  "which kills the feature. Never add a third option, and never turn the exit " +
  "into an alternative route ('show me my lenses instead'), which reintroduces " +
  "the choice this rule removes. The gate IS the widget: never render it as a " +
  "prose question — 'say the word and I'll check it' is a defect, not a gate. " +
  "Typing also works: if the user types something off-script, abandon the " +
  "walkthrough and serve what they asked.";

/** The exit option every gate carries, so the widget has a valid 2-option shape. */
const EXIT_OPTION = {
  label: "I'm done for now",
  description: "Stop the walkthrough here.",
  kind: "walkthrough_exit",
};

const INTRO =
  "Keep the opening TINY — two lines, then the widget, all in your first " +
  "message. (1) One sentence on what Leadbay does FOR THEM, in their language: " +
  "'Leadbay brings you a fresh batch of companies worth selling to every day — " +
  "you tell it who you're after, it goes and finds them.' (2) One short line " +
  "that sets up the tour and says it's hands-on, e.g. 'I'll walk you through " +
  "it — five quick steps, and you'll have real leads by the end. First, let's " +
  "see which account you're on.' (3) Fire gate 1's widget immediately, then " +
  "stop. Do NOT preview all five steps one by one, do NOT explain what a lens " +
  "is yet, do NOT list what's coming — each gate explains itself when its turn " +
  "arrives, and front-loading it buries the first button under text nobody " +
  "reads. Call no tool in the opening.";

// Every `say` below is verbatim from that tool's own routing.triggers, so the
// phrase the tutorial teaches is one the agent actually routes on. If a tool's
// triggers change, change these with them.
const KEEP_GOING: PhraseCard[] = [
  { want: "Today's fresh leads", say: "Show me today's leads" },
  { want: "Who to follow up with", say: "What should I follow up on" },
  { want: "The story on one company", say: "Research <Company>" },
  { want: "An email to a contact", say: "Draft outreach for <Contact>" },
  { want: "Change who you target", say: "Narrow the audience to <sector>" },
  { want: "Switch target audience", say: "Show me my lenses" },
];

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
      gate_label: "Check my account",
      gate_description: "Check my Leadbay account status.",
      explain:
        "The opening two lines ARE this gate's explanation — do not add another " +
        "paragraph. One sentence on what Leadbay is, one line naming this step, " +
        "then fire the widget in the SAME message. On click, the ANSWER is the " +
        "account itself: user + org, then the full quota windows (see branches).",
      next_steps: {
        question: "Let's start with your account status.",
        options: [
          {
            label: "Check my account",
            description: "Check my Leadbay account status.",
            kind: "walkthrough_account_status",
          },
          EXIT_OPTION,
        ],
      },
      calls: "leadbay_account_status",
      args: {},
      branches: [
        {
          when: "quota is readable",
          then:
            "Show them their ACTUAL account — this is the payoff of the click. One line on who they're signed in as and their organization, then render the quota windows in full the way the web app does: Daily / Weekly / Monthly, each with a ▰▱ gauge, % used, $ spent against the cap, and when it resets, plus the per-resource breakdown underneath. Follow the canonical quota-windows rendering (never raw 'credits'). A one-line 'you're connected as X' under-delivers on a button labelled 'check my account status'.",
        },
        {
          when: "quota is null, quota_error is set, or organization.unlimited_credits is true",
          then:
            "Say NOTHING about quota — no gauge, no 'unreadable', no 'unlimited'. A brand-new org often has no billing plan yet, so the quota read fails; that is not an error worth showing. Do not mention a 401, and above all do NOT tell the user to log in again or reconnect: their token is fine, the same response just read their account. Fall back to the short user + org line and move on. (WORKFLOWS #30.)",
        },
        {
          when: "always",
          then:
            "Do NOT volunteer the lens. The response deliberately withholds it unless the user asked, so there is nothing to report, and no other tool should be called to find it. The lens appears naturally at gate 2. (WORKFLOWS #31.)",
        },
      ],
    },
    {
      n: 2,
      gate_label: "Pull today's leads",
      gate_description: "Pull today's leads from your lens.",
      explain:
        "Explain the LENS before firing: Leadbay keeps a lens — the description " +
        "of who they sell to — and every day it finds fresh companies matching " +
        "it. This click pulls today's batch.",
      next_steps: {
        question: "Now let's see today's leads. Ready?",
        options: [
          {
            label: "Pull today's leads",
            description: "Pull today's leads from your lens.",
            kind: "walkthrough_pull_leads",
          },
          EXIT_OPTION,
        ],
      },
      calls: "leadbay_pull_leads",
      args: {},
      pin: "lens.id — pass as an explicit lensId on every later step, so step 3 enriches the same lens the user just saw",
      branches: [
        {
          when: "leads.length > 0",
          then: "Render the canonical pull_leads table, then advance to gate 3.",
        },
        {
          when: "leads.length === 0 && (computing_wishlist || computing_scores)",
          then:
            "The lens is still building — normal on a new account. Say so in the user's terms, then render the tool's own next_steps payload VERBATIM (it carries two options: 'Re-pull in ~30s' / 'Refine audience'). This is the ONE place a gate carries two options, because the server built the payload. On re-pull, wait ~30s and return to gate 2. NEVER say 'no leads found'.",
        },
        {
          when: "leads.length === 0 && !computing_wishlist && !computing_scores",
          then:
            "The lens is genuinely empty or too narrow and next_steps is null. Say so honestly, offer to widen the audience, and end the walkthrough — there is nothing to enrich.",
        },
      ],
    },
    {
      n: 3,
      gate_label: "Enrich top leads",
      gate_description: "See who to contact at the top leads.",
      explain:
        "Explain what enrichment IS before firing: a company is not a person, so " +
        "Leadbay can find WHICH ROLES to approach at these companies. Say plainly " +
        "that this preview is free and reveals no emails or phone numbers — that " +
        "is a separate paid step they confirm later.",
      next_steps: {
        question: "Want to see who to contact at these companies?",
        options: [
          {
            label: "Enrich top leads",
            description: "See who to contact at the top leads. Free — no contact details revealed.",
            kind: "walkthrough_enrich_titles",
          },
          EXIT_OPTION,
        ],
      },
      calls: "leadbay_enrich_titles",
      args: {
        leadIds: "<the lead ids from step 2>",
        lensId: "<the pinned lens id from step 2>",
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
      n: 4,
      gate_label: "Add these to my CRM",
      gate_description: "Put these leads into your CRM.",
      explain:
        "Explain the split before firing: Leadbay finds the leads, but their CRM " +
        "is where they'll actually work them — and if a CRM connector is available " +
        "in this chat, these companies can go straight in. Do not promise it works " +
        "until you have checked your own tool set.",
      next_steps: {
        question: "Want these leads in your CRM?",
        options: [
          {
            label: "Add these to my CRM",
            description: "Put these leads into your CRM, if a connector is available here.",
            kind: "walkthrough_crm_push",
          },
          EXIT_OPTION,
        ],
      },
      calls: null,
      args: null,
      handoff:
        "Leadbay has NO CRM integration — it cannot push, export or sync a lead " +
        "anywhere, which is why `calls` is null. But the AGENT often can: many " +
        "users run a CRM connector alongside Leadbay in the same host. Check your " +
        "own tool set for a CRM capability (HubSpot, Salesforce, Pipedrive, Attio, " +
        "Close, or similar) the same way you detect outreach tooling — the host's " +
        "installed-connector / installed-MCP inventory when available, otherwise " +
        "the conversation, otherwise ask which CRM they use. If you have one, use " +
        "it to create or update the company + its contact from the lead data " +
        "already in hand: company name, website, city/region, contact name and job " +
        "title. You do NOT have the contact's email or phone — gate 2 was the free " +
        "preview — so never write a contact detail you did not receive. If you have " +
        "no CRM connector, say so in one honest line, name the CRM the user " +
        "mentioned, and offer leadbay_report_friction with " +
        "category:'missing_capability'. NEVER claim a CRM record was created unless " +
        "the connector confirmed it — only the connector can create one.",
    },
    {
      n: 5,
      gate_label: "Run this every morning",
      gate_description: "Set this up to run automatically every morning.",
      explain:
        "Close the loop before firing: prospecting works when it's a habit, not a " +
        "one-off — and the whole sequence they just did can run on its own every " +
        "morning, so fresh leads are waiting instead of being something to remember.",
      next_steps: {
        question: "Want this to run on its own every morning?",
        options: [
          {
            label: "Run this every morning",
            description: "Set this up to run automatically every morning.",
            kind: "walkthrough_schedule",
          },
          EXIT_OPTION,
        ],
      },
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
  keep_going: KEEP_GOING,
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
