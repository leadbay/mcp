/**
 * Prompt catalog — registered slash-commands the user can invoke
 * directly via the MCP client (Claude Desktop, Cursor).
 *
 * Each prompt encodes a workflow chain that would otherwise require
 * the agent to reconstruct from scratch on every session. Per
 * MCP 2025-11-25 §Prompts, prompts are pull-based: the client lists
 * them, the user picks one, the client invokes prompts/get with
 * arguments, the rendered messages become the agent's input.
 *
 * Backwards-compat: clients without prompts capability ignore the
 * catalog entirely.
 */

import type {
  Prompt,
  PromptArgument,
  GetPromptResult,
  PromptMessage,
} from "@modelcontextprotocol/sdk/types.js";

interface CatalogEntry {
  name: string;
  description: string;
  arguments: PromptArgument[];
  // Render must produce a non-empty messages array per spec. The first
  // message is typically a `user` role with text content the agent
  // consumes as its instruction.
  render: (args: Record<string, string | undefined>) => PromptMessage[];
}

function userMessage(text: string): PromptMessage {
  return { role: "user", content: { type: "text", text } };
}

const CATALOG: CatalogEntry[] = [
  {
    name: "leadbay_daily_check_in",
    description:
      "Run the canonical daily check-in: see account state, pull fresh leads, and surface the most-promising one for review. The user's typical morning workflow.",
    arguments: [],
    render: () => [
      userMessage(
        "Run the Leadbay daily check-in for me:\n" +
          "1. Call leadbay_account_status to see what quota I have left and which lens is active.\n" +
          "2. Call leadbay_pull_leads to get today's fresh batch.\n" +
          "3. Show me the top 3 — by ai_agent_lead_score when present, otherwise by score. " +
          "For each, summarize qualification_summary in one sentence.\n" +
          "4. Recommend ONE lead to research deeply, and call leadbay_research_lead on it. " +
          "Tell me what makes it promising, what signals stand out, and what would be the right outreach move.\n" +
          "5. Stop. Wait for me to decide what to do next. Do not call leadbay_report_outreach unless I explicitly say so."
      ),
    ],
  },
  {
    name: "leadbay_research_a_domain",
    description:
      "Import a company by domain and run deep qualification + research in one pass. Use when a colleague mentions a name and you want everything Leadbay knows about it.",
    arguments: [
      {
        name: "domain",
        description:
          "The company's primary domain (e.g. 'acme.com'). Protocol/path are stripped.",
        required: true,
      },
    ],
    render: (args) => [
      userMessage(
        `Research the company with domain '${args.domain ?? "<missing>"}' for me using Leadbay:\n` +
          `1. Call leadbay_import_and_qualify with domains=[{domain:'${args.domain ?? ""}'}]. This imports the lead AND runs AI qualification.\n` +
          `2. When the import resolves, call leadbay_research_lead on the new leadId.\n` +
          `3. Summarize: who is this company, what's their fit (qualification answers), what signals stand out, and which contact would I email first. Be honest about uncertainty.`
      ),
    ],
  },
  {
    name: "leadbay_refine_audience",
    description:
      "Refine the kind of leads Leadbay surfaces beyond firmographics, with a free-text instruction. Handles the clarification round-trip if the new prompt is ambiguous.",
    arguments: [
      {
        name: "instruction",
        description:
          "The refinement (e.g. 'focus on hospitals running their own IT'). Set to plain English.",
        required: true,
      },
    ],
    render: (args) => [
      userMessage(
        `Refine the Leadbay audience prompt to: ${args.instruction ?? "<missing>"}\n\n` +
          `1. Call leadbay_refine_prompt with prompt=<the instruction above>.\n` +
          `2. If the response includes a 'clarification' block, surface the question + options to me VERBATIM and wait. Do NOT call leadbay_answer_clarification on my behalf — I want to choose.\n` +
          `3. If the response status is 'applied', tell me Leadbay is regenerating intelligence and recommend I check back in a few minutes via leadbay_account_status (computing_intelligence flips to false when ready).`
      ),
    ],
  },
  {
    name: "leadbay_log_outreach",
    description:
      "Log outreach (an email I sent, a call I made, a meeting I had) on a specific lead. Captures verification so the SDR pipeline trusts the entry.",
    arguments: [
      {
        name: "lead_id",
        description: "The lead UUID. Get it from leadbay_pull_leads or leadbay_research_lead.",
        required: true,
      },
      {
        name: "summary",
        description:
          "1-2 sentences describing what I did (e.g. 'Sent intro email to CTO citing recent Hornsea contract').",
        required: true,
      },
    ],
    render: (args) => [
      userMessage(
        `Log this outreach on Leadbay lead ${args.lead_id ?? "<missing>"}:\n` +
          `Summary: ${args.summary ?? "<missing>"}\n\n` +
          `Before calling leadbay_report_outreach, ask me ONCE for verification:\n` +
          `- If I sent an email: ask for the Gmail message id (verification.source = 'gmail_message_id').\n` +
          `- If I booked a meeting: ask for the calendar event id (verification.source = 'calendar_event_id').\n` +
          `- Otherwise: ask me for a literal one-sentence confirmation that the outreach happened (verification.source = 'user_confirmed', verification.ref = my exact words).\n\n` +
          `After I answer, call leadbay_report_outreach({lead_id, note: <summary>, verification: {source, ref}}). Optionally pass dry_run:true first to confirm what would be sent.`
      ),
    ],
  },
  {
    name: "leadbay_qualify_top_n",
    description:
      "Bulk-qualify the top N un-qualified leads in the active lens. Uses leadbay_bulk_qualify_leads with a sensible default budget.",
    arguments: [
      {
        name: "count",
        description:
          "How many leads to qualify (default 10, max 25). Higher counts may take 5+ minutes.",
        required: false,
      },
    ],
    render: (args) => {
      const n = args.count ?? "10";
      return [
        userMessage(
          `Qualify the top ${n} un-qualified leads in the active Leadbay lens:\n` +
            `1. Call leadbay_bulk_qualify_leads with count=${n}.\n` +
            `2. While it polls, expect notifications/progress events showing per-lead transitions.\n` +
            `3. When it returns, summarize: how many qualified, how many still running, and the 3 highest-boost-score leads with their qualification_summary.\n` +
            `4. Recommend the single most promising lead and offer to research it deeply with leadbay_research_lead.`
        ),
      ];
    },
  },
];

export function listPrompts(): Prompt[] {
  return CATALOG.map((c) => ({
    name: c.name,
    description: c.description,
    arguments: c.arguments,
  }));
}

export function getPrompt(
  name: string,
  args: Record<string, string | undefined> = {}
): GetPromptResult {
  const entry = CATALOG.find((c) => c.name === name);
  if (!entry) {
    throw new Error(`Unknown prompt: ${name}`);
  }
  // Validate required arguments. Per spec, missing required args should
  // surface as a JSON-RPC error so the client can re-prompt the user.
  const missing = entry.arguments
    .filter((a) => a.required && (args[a.name] === undefined || args[a.name] === ""))
    .map((a) => a.name);
  if (missing.length > 0) {
    throw new Error(
      `Missing required prompt arguments: ${missing.join(", ")}`
    );
  }
  return {
    description: entry.description,
    messages: entry.render(args),
  };
}
