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
import {
  leadbay_build_campaign,
  leadbay_daily_check_in,
  leadbay_getting_started,
  leadbay_import_file,
  leadbay_log_outreach,
  leadbay_plan_tour_in_city,
  leadbay_prospecting_overview,
  leadbay_qualify_top_n,
  leadbay_refine_audience,
  leadbay_research_a_domain,
  leadbay_setup_team_prospecting,
  leadbay_top_accounts_to_activate,
  leadbay_work_campaign,
  PROMPT_META,
} from "./prompts.generated.js";

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

/**
 * Substitute `{{arg:NAME}}` placeholders in a generated prompt body.
 * Used by prompts that source their body from prompts.generated.ts.
 * The placeholder names are not necessarily 1:1 with MCP arg names:
 * a placeholder name may equal an arg name, OR start with `<arg>_` to
 * encode conditional/wrapping logic (see leadbay_import_file).
 */
function substitutePlaceholders(
  body: string,
  substitutions: Record<string, string>,
): string {
  let out = body;
  for (const [placeholder, value] of Object.entries(substitutions)) {
    out = out.split(`{{arg:${placeholder}}}`).join(value);
  }
  return out;
}

/**
 * `prompts/list` argument metadata, sourced from the generated file.
 *
 * These used to be hand-copied into the catalog below, and they drifted: seven
 * argument descriptions no longer matched their templates, including every one
 * carrying the single-country warning (product#3951). The audit asserted the
 * GENERATED text and passed, while `prompts/list` served the stale hand-written
 * copy — so a guard the audit proved existed was never actually delivered to a
 * client. Reading them here makes the .md.tmpl frontmatter the only place an
 * argument description is written.
 */
function promptArguments(name: keyof typeof PROMPT_META): PromptArgument[] {
  return PROMPT_META[name].arguments.map(
    (argument: { name: string; description: string; required: boolean }) => ({ ...argument })
  );
}

const CATALOG: CatalogEntry[] = [
  {
    name: "leadbay_daily_check_in",
    description: PROMPT_META.leadbay_daily_check_in.short_description,
    arguments: promptArguments("leadbay_daily_check_in"),
    render: () => [userMessage(leadbay_daily_check_in)],
  },
  {
    name: "leadbay_prospecting_overview",
    description: PROMPT_META.leadbay_prospecting_overview.short_description,
    arguments: promptArguments("leadbay_prospecting_overview"),
    render: () => [userMessage(leadbay_prospecting_overview)],
  },
  {
    name: "leadbay_research_a_domain",
    description: PROMPT_META.leadbay_research_a_domain.short_description,
    arguments: promptArguments("leadbay_research_a_domain"),
    render: (args) => [
      userMessage(
        substitutePlaceholders(leadbay_research_a_domain, {
          domain: args.domain ?? "<missing>",
        }),
      ),
    ],
  },
  {
    name: "leadbay_import_file",
    description: PROMPT_META.leadbay_import_file.short_description,
    arguments: promptArguments("leadbay_import_file"),
    render: (args) =>
      [
        userMessage(
          substitutePlaceholders(leadbay_import_file, {
            file_paren: args.file ? ` (${args.file})` : "",
            instruction_or_default:
              args.instruction ??
              "import the rows, resolve identities, and qualify leads if the user asked for qualification",
          }),
        ),
      ],
  },
  {
    name: "leadbay_refine_audience",
    description: PROMPT_META.leadbay_refine_audience.short_description,
    arguments: promptArguments("leadbay_refine_audience"),
    render: (args) => [
      userMessage(
        substitutePlaceholders(leadbay_refine_audience, {
          instruction: args.instruction ?? "<missing>",
        }),
      ),
    ],
  },
  {
    name: "leadbay_log_outreach",
    description: PROMPT_META.leadbay_log_outreach.short_description,
    arguments: promptArguments("leadbay_log_outreach"),
    render: (args) => [
      userMessage(
        substitutePlaceholders(leadbay_log_outreach, {
          lead_id: args.lead_id ?? "<missing>",
          summary: args.summary ?? "<missing>",
        }),
      ),
    ],
  },
  {
    name: "leadbay_plan_tour_in_city",
    description: PROMPT_META.leadbay_plan_tour_in_city.short_description,
    arguments: promptArguments("leadbay_plan_tour_in_city"),
    render: (args) => [
      userMessage(
        substitutePlaceholders(leadbay_plan_tour_in_city, {
          city: args.city ?? "<missing>",
          date_paren: args.date ? ` on ${args.date}` : "",
          date_dash: args.date ? ` – ${args.date}` : "",
        }),
      ),
    ],
  },
  {
    name: "leadbay_build_campaign",
    description: PROMPT_META.leadbay_build_campaign.short_description,
    arguments: promptArguments("leadbay_build_campaign"),
    render: (args) => {
      const n = args.count ?? "20";
      return [
        userMessage(
          substitutePlaceholders(leadbay_build_campaign, {
            audience_block: args.audience
              ? `Target audience: **${args.audience}** — if my active lens doesn't already cover it, set it up first and continue on it (no need to ask me).`
              : "Use my active Leadbay lens as the audience.",
            campaign_name_paren: args.campaign_name
              ? ` named **${args.campaign_name}**`
              : "",
            count_or_default: n,
            job_titles_block: args.job_titles
              ? `Enrich exactly these buyer titles: **${args.job_titles}**. A lead only counts toward the ${n} when it has a reachable contact matching one of these titles.`
              : `No titles given — derive my buyer persona from what I sell (Phase 3 Step A) and enrich those titles.`,
          }),
        ),
      ];
    },
  },
  {
    name: "leadbay_setup_team_prospecting",
    description: PROMPT_META.leadbay_setup_team_prospecting.short_description,
    arguments: promptArguments("leadbay_setup_team_prospecting"),
    render: (args) => [
      userMessage(
        substitutePlaceholders(leadbay_setup_team_prospecting, {
          audience: args.audience ?? "<missing>",
          rep_split_block: args.rep_split
            ? `Rep split preference: **${args.rep_split}**\n`
            : "",
        }),
      ),
    ],
  },
  {
    name: "leadbay_work_campaign",
    description: PROMPT_META.leadbay_work_campaign.short_description,
    arguments: promptArguments("leadbay_work_campaign"),
    render: (args) => [
      userMessage(
        substitutePlaceholders(leadbay_work_campaign, {
          campaign_or_default: args.campaign ?? "<pick from the list>",
          mode_paren: args.mode ? ` (mode: ${args.mode})` : "",
        }),
      ),
    ],
  },
  {
    name: "leadbay_qualify_top_n",
    description: PROMPT_META.leadbay_qualify_top_n.short_description,
    arguments: promptArguments("leadbay_qualify_top_n"),
    render: (args) => {
      const n = args.count ?? "10";
      return [
        userMessage(
          substitutePlaceholders(leadbay_qualify_top_n, {
            count_or_default: n,
          }),
        ),
      ];
    },
  },
  {
    name: "leadbay_top_accounts_to_activate",
    description: PROMPT_META.leadbay_top_accounts_to_activate.short_description,
    arguments: promptArguments("leadbay_top_accounts_to_activate"),
    render: (args) => {
      const n = args.count ?? "50";
      return [
        userMessage(
          substitutePlaceholders(leadbay_top_accounts_to_activate, {
            count_or_default: n,
            // The country caveat is INSIDE the substituted string, not only in
            // the prompt body, because this sentence is the FIRST instruction
            // the agent reads and the body's country branch is ~35 lines below
            // it. Rendered with `territory: "France"`, the old wording told the
            // agent in its opening paragraph to pass a country as `locations` —
            // the exact call this prompt later forbids (product#3951). The
            // audit could not see it either: it reads prompts.generated.ts,
            // where this is still an unexpanded `{{arg:territory_block}}`.
            territory_block: args.territory
              ? `Scope the plan to **${args.territory}** — but ONLY if it names a place INSIDE this workspace's country (state / région / département / county / city): pass that as \`locations\` on the lens, never as a sector. If **${args.territory}** is a country or a supra-national area (EU, EMEA), it is NOT a location filter — do not pass it as \`locations\` at all; follow the country branch below instead.`
              : "",
          }),
        ),
      ];
    },
  },
  {
    // Guided first-run walkthrough (issue #3952). No arguments — the tour is
    // the same for every new user, and asking a brand-new user to parameterize
    // their own onboarding defeats the point.
    name: "leadbay_getting_started",
    description: PROMPT_META.leadbay_getting_started.short_description,
    arguments: promptArguments("leadbay_getting_started"),
    render: () => [userMessage(leadbay_getting_started)],
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
