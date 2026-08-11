import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext } from "../types.js";

import { leadbay_getting_started as GETTING_STARTED_DESCRIPTION } from "../tool-descriptions.generated.js";

// leadbay_getting_started returns the guided first-run walkthrough (issue
// leadbay/product#3952): a short script the agent drives so a brand-new user
// learns Leadbay by DOING. Four gates, each carrying ONE forward action plus an
// exit (two options — a lone option degrades to prose on real hosts). Makes
// no backend call and mutates nothing — the manifest is static, version-locked
// content.
//
// Gate 1 (leadbay_account_status) is the tutorial's "you're connected" beat and
// carries two PINNED regressions in its branches: stay silent when quota_error
// is set (WORKFLOWS #30) and never volunteer the lens (WORKFLOWS #31, enforced
// server-side — account-status.ts withholds it unless the trigger text asks).
//
// Every gate calls a real Leadbay tool. The CRM push and the recurring
// schedule were gates 5 and 6 with `calls: null`, delegating to the host's own
// connector and scheduler — both removed: the tour ends where Leadbay's own
// value ends, with a contact revealed. A tutorial that finishes by handing off
// to capabilities Leadbay does not have was two steps of somebody else's
// product, and it pushed the payoff further from the click that earned it.
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
// so the tour is REACHABLE on a read-only (LEADBAY_MCP_WRITE=0) deployment —
// but gate 4's leadbay_enrich_titles is write-gated and absent there, so that
// gate carries a branch ending the tour after gate 3 rather than offering a
// button whose tool cannot run.

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
  /** What this step does or doesn't cost, and the consent it requires first. */
  spend?: string;
  /** What to tell the user about the credits this step consumed. */
  quota_note?: string;
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
  /** The canonical setup guide — install, sign-in, "my tools aren't showing up". */
  docs_url: string;
  /** The only two moments that link should appear. See DOCS_NOTE. */
  docs_note: string;
  /** 1:1 setup session offered when the user takes the exit. PLACEHOLDER url. */
  calendly_url: string;
  /** How and when to make that offer — exit click only, never mid-tour. */
  exit_offer: string;
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

/**
 * The setup guide: installing the connector, signing in, running the first
 * query, and what to do when the Leadbay tools don't appear. It is the step
 * BEFORE this walkthrough — the tour assumes an installed, signed-in connector
 * and gate 1 is what proves it.
 */
const DOCS_QUICKSTART = "https://docs.leadbay.app/doc/leadbay-mcp/quickstart";

const DOCS_NOTE =
  "Surface this link in exactly TWO moments and nowhere else. (1) BEFORE the " +
  "tour, when the user's problem is SETUP rather than usage — the connector " +
  "isn't installed, they can't sign in, their Leadbay tools aren't appearing, " +
  "or they want to run this on another host. The walkthrough cannot fix any of " +
  "that: it assumes a working connection, and gate 1 is what proves it. Point " +
  "them at the page instead of guessing at install steps. (2) At the CLOSING, " +
  "as one plain link beside the keep_going cheat-sheet, for what the four gates " +
  "didn't cover — installing on another machine, adding a teammate, signing in " +
  "again later. NEVER paste it between gates: a link mid-tour is an invitation " +
  "to leave the thing they're in the middle of doing.";

/**
 * Zoe's real booking link. The `?month=` param Calendly hands out is stripped
 * on purpose: it only pins which month the picker opens on, and this URL
 * outlives any given month — a link shipped with `month=2026-08` opens on a
 * stale calendar for every user who clicks it after August.
 */
const ZOE_CALENDLY = "https://calendly.com/zoe-leadbay/demo-leadbay";

/**
 * What to say when the user takes the exit. They just said they were done, so
 * this is one line and a link — an offer, never a pitch, and never a reason to
 * re-open the tour.
 */
const EXIT_OFFER =
  "Picking 'I'm done for now' is ENDING B, and it has THREE beats in order: " +
  "(1) one short line acknowledging the stop, (2) the keep_going cheat-sheet " +
  "and the docs_url link, (3) the 1:1 offer — LAST, and REQUIRED. Beat 3 is " +
  "the one that gets dropped: an agent that renders the cheat-sheet feels " +
  "finished and stops, so the user who just stepped out never hears about the " +
  "help that would have brought them back. An exit close WITHOUT the offer is " +
  "incomplete. ONE SENTENCE and calendly_url, e.g. 'If you want a hand tuning " +
  "this to your own market, Zoe on our team runs 1:1 sessions: <url>'. That " +
  "length is the rule, not a suggestion — do NOT enumerate everything Zoe " +
  "could help with, which turns an offer into promotional copy and is exactly " +
  "what someone who just said they were done does not want. Never re-open the " +
  "walkthrough, never re-fire the declined gate, and " +
  "never argue for finishing the tour. If they instead left by TYPING " +
  "something off-script that is ENDING C, not B — serve what they asked and " +
  "skip the cheat-sheet, the link AND the offer.";

/** The exit option every gate carries, so the widget has a valid 2-option shape. */
const EXIT_OPTION = {
  label: "I'm done for now",
  description: "Stop the walkthrough here.",
  kind: "walkthrough_exit",
};

// Picking EXIT_OPTION ends the tour — and is the one moment a 1:1 offer is
// welcome rather than pushy: they've seen enough to know what Leadbay is, and
// stopped before the setup work a call actually helps with. See EXIT_OFFER.

const INTRO =
  "Open with a SHORT paragraph — 3-4 sentences, then the widget, all in your " +
  "first message. Cover, in the user's own language and without jargon: " +
  "(1) what Leadbay is — it brings you a fresh batch of companies worth " +
  "selling to every day, rather than you hunting for them; (2) how it knows " +
  "what to send — you describe who you sell to (that description is your " +
  "LENS) and it goes and finds companies matching it, learning from what you " +
  "engage with; (3) what this walkthrough will do — four quick steps, each one " +
  "a real action on their own account, ending with leads in hand, a first " +
  "email already written, and the person to send it to; (4) one line handing off to the first " +
  "step, e.g. 'First, let's see which account you're on.' Then fire gate 1's " +
  "widget immediately and stop. Keep it to a paragraph — do NOT walk through " +
  "the four steps one at a time here (each gate explains itself when its turn " +
  "arrives), and call no tool in the opening.";

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
  "The walkthrough DRAFTS an email at gate 3 but never SENDS one. The draft " +
  "stays in the chat for the user to read and judge; nothing leaves. Never " +
  "send it, never offer to send it on their behalf, and never call " +
  "leadbay_report_outreach — logging an outreach that never happened poisons " +
  "the human team's pipeline. End by waiting for the user.";

export const GETTING_STARTED_MANIFEST: GettingStartedManifest = {
  version: 1,
  intro: INTRO,
  one_option_rule: ONE_OPTION_RULE,
  docs_url: DOCS_QUICKSTART,
  docs_note: DOCS_NOTE,
  calendly_url: ZOE_CALENDLY,
  exit_offer: EXIT_OFFER,
  steps: [
    {
      n: 1,
      gate_label: "Check my account",
      gate_description: "Check my Leadbay account status.",
      explain:
        "The opening paragraph IS this gate's explanation — do not add another " +
        "one. Just hand off in a line ('First, let's see which account you're " +
        "on') and fire the widget in the SAME message. WHY IT'S USEFUL, if you " +
        "say anything at all: this is where they can see at a glance how much " +
        "they've used this week and what's left, so a batch that comes back " +
        "small later has a visible reason. On click, the ANSWER is the account " +
        "itself: user + org, then the full quota windows (see branches).",
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
            "Show them their ACTUAL account — this is the payoff of the click. One line on who they're signed in as and their organization, then render the quota windows in full the way the web app does: Daily / Weekly / Monthly, each with a ▰▱ gauge, % used, $ spent against the cap, and when it resets, plus the per-resource breakdown underneath. Follow the canonical quota-windows rendering (never raw 'credits'). A one-line 'you're connected as X' under-delivers on a button labelled 'check my account status'. THEN EXPLAIN IT in one or two plain lines — a first-run user has never seen these numbers and can't tell if they're good or bad: say what it counts (the AI work Leadbay does for them — researching companies and qualifying leads, not something they spend by clicking around) and why it matters (it paces how many fresh leads arrive; heavy use now means a bigger batch queued for next time, and it's where a smaller-than-expected batch would show its reason). Keep it to a sentence or two, don't walk through every resource row, and don't turn it into a pricing pitch.",
        },
        {
          when: "quota is null, quota_error is set, or organization.unlimited_credits is true",
          then:
            "Say NOTHING about quota — no gauge, no 'unreadable', no 'unlimited', and skip the quota EXPLANATION too (there is nothing on screen to explain, and describing an absent gauge just confuses). A brand-new org often has no billing plan yet, so the quota read fails; that is not an error worth showing. Do not mention a 401, and above all do NOT tell the user to log in again or reconnect: their token is fine, the same response just read their account. Fall back to the short user + org line and move on. (WORKFLOWS #30.)",
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
        "it. This click pulls today's batch. WHY IT'S USEFUL: it replaces the " +
        "hour spent digging through directories and LinkedIn for someone worth " +
        "calling — the list is already waiting, scored, when they sit down. And " +
        "it gets sharper: the leads they like, contact or skip teach the lens " +
        "what a good fit looks like, so tomorrow's batch is closer than today's.",
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
      pin: "lens.id — pass as an explicit lensId on every later step, so step 4 enriches the same lens the user just saw. Also pin the TOP-SCORING lead's id and name: gate 3 drafts to it, and gate 4 reveals its contact",
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
      gate_label: "Draft the first email",
      gate_description: "Write a first email to the best company in today's batch.",
      explain:
        "Name the TOP-SCORING lead from gate 2 out loud, so the offer is about a " +
        "real company and not an abstraction. Explain what's about to happen: " +
        "Leadbay already worked out WHY this company fits them, so it can write " +
        "the first email instead of leaving them at a blank page. WHY IT'S " +
        "USEFUL: finding companies was never the hard part — writing the " +
        "twentieth opener of the day is where prospecting actually dies. This " +
        "turns a row in a table into something they could send in a minute. Say " +
        "plainly that it only DRAFTS: nothing is sent, and they see it first.",
      next_steps: {
        question: "Want me to draft the first email to your top lead?",
        options: [
          {
            label: "Draft the first email",
            description: "Write a first email to the best company in today's batch. Nothing is sent.",
            kind: "walkthrough_draft_outreach",
          },
          EXIT_OPTION,
        ],
      },
      calls: "leadbay_prepare_outreach",
      args: {
        leadId: "<the highest-scoring lead id from step 2>",
      },
      forbidden_args: [
        "enrich — enrich:true launches a PAID contact reveal off the back of a DRAFT click. They agreed to see an email written, not to spend. Gate 4 is where the reveal gets asked for, explicitly and on its own terms.",
      ],
      spend:
        "This gate spends NOTHING. Call leadbay_prepare_outreach with leadId and " +
        "nothing else. `recommended_contact` comes back in its post-enrichment " +
        "shape with email and phone still null — that is EXPECTED, not a failure, " +
        "and it is precisely the hook for gate 4: an email written, and nobody to " +
        "send it to yet. Do not apologise for the missing contact, and do not " +
        "reach for another tool to fill it in.",
      branches: [
        {
          when: "always",
          then:
            "Render the draft through message_compose_v1 — kind:'email', a summary_title naming the company, and 2-3 variants whose labels name the STRATEGY ('Lead with the growth signal', 'Ask about their current setup'), never the tone. Do NOT also paste the body into chat prose; the composer IS the answer. Address it to the recommended contact's JOB TITLE ('the Head of Operations at <Company>') — you do not have a name yet, and inventing one is fabrication. Say in one line what made this company the pick: its score and the fit reason from the lead's summary, so the draft reads as reasoned rather than generated.",
        },
        {
          when: "the host exposes no message_compose_v1",
          then:
            "Fall back to the canonical prepare-outreach rendering: one short context line, then the subject and body as a quoted block. Same content, same no-name rule.",
        },
      ],
    },
    {
      n: 4,
      gate_label: "Find who to email",
      gate_description: "Reveal the person at that company to send the draft to.",
      explain:
        "Point straight at the gap the draft just opened: they have an email " +
        "ready and nobody to send it to — it's addressed to a job title, not a " +
        "person. That's what this step fixes. Explain what enrichment IS: " +
        "Leadbay can find which roles exist at that company, then reveal the " +
        "actual human and how to reach them. WHY IT'S USEFUL: they ask for the " +
        "operations director by name instead of pitching whoever answers the " +
        "switchboard — the difference between a conversation and a dead end. Say " +
        "plainly that the first look is free, and that revealing the contact " +
        "costs credits and needs their say-so.",
      next_steps: {
        question: "Want to find out who to send that email to?",
        options: [
          {
            label: "Find who to email",
            description: "See the roles at that company. Free — no contact details revealed yet.",
            kind: "walkthrough_enrich_titles",
          },
          EXIT_OPTION,
        ],
      },
      calls: "leadbay_enrich_titles",
      branches: [
        {
          when: "leadbay_enrich_titles is NOT in your tool set",
          then:
            "This is a read-only deployment (LEADBAY_MCP_WRITE=0) — the reveal tool simply is not registered. Do NOT fire this gate's widget, and do not hunt for another way to get contact details. Close the tour after gate 3 instead: say plainly that revealing contacts isn't enabled on this connection, that the draft they just watched being written is still theirs, and go to the closing. A gate whose tool cannot run is a dead end, and offering the button anyway is worse than ending one step early.",
        },
      ],
      args: {
        leadIds: "<the ONE lead you drafted for at step 3>",
        lensId: "<the pinned lens id from step 2>",
      },
      spend:
        "TWO BEATS — free preview FIRST, the real reveal only after the user " +
        "confirms. Beat 1: call leadbay_enrich_titles with the drafted lead's id + " +
        "lensId and NO titles / NO confirm / NO email / NO phone. That returns " +
        "mode:'discover' — the FREE list of job titles at that company. Say plainly " +
        "that nothing has been spent yet. Beat 2: name the title the draft is " +
        "addressed to, tell them BEFORE they decide what it costs (one credit per " +
        "contact revealed — here that is ONE contact, one credit), and ask them to " +
        "confirm. Only then call leadbay_enrich_titles AGAIN with leadIds: [<that " +
        "lead id>] — ALWAYS the array, even for a single lead: `leadId` singular is " +
        "not a key this tool reads, so it is dropped and the paid call falls back to " +
        "the default wishlist selection, charging for the whole batch — plus the " +
        "chosen title, confirm:true and email:true. Poll leadbay_bulk_enrich_status " +
        "with the returned bulk_id until all_done (or the count plateaus), and " +
        "report the contact that actually resolved. NEVER launch the reveal without " +
        "an explicit confirm: silence is not consent, and neither is 'they clicked " +
        "the gate'. If they decline, keep the draft and the title and move on — " +
        "that is a normal outcome, not a failure.",
      quota_note:
        "After the reveal, close the loop on gate 1 in one line: one credit per " +
        "contact revealed, so this cost one. Then say the thing that makes it land " +
        "— the draft from gate 3 now has a real person and a real address to go " +
        "to. Re-check leadbay_account_status if you want to show the moved windows. " +
        "This is where gate 1's numbers stop being abstract: they just watched them " +
        "move, and got something for it. Keep it to a line; no pricing pitch.",
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
    // A DEEP COPY, never the singleton itself. The server attaches per-call
    // metadata (`_meta.update_available`, `_meta.notifications`) to successful
    // result objects IN PLACE. Returning GETTING_STARTED_MANIFEST by reference
    // let those fields stick to the module-level constant, so a later call in
    // the same process could carry another call's notifications — including
    // ones the user had already acknowledged. The manifest is static content;
    // the response is per-call, and the two must not be the same object.
    return structuredClone(GETTING_STARTED_MANIFEST);
  },
};
