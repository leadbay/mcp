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
  leadbay_import_file,
  leadbay_log_outreach,
  leadbay_plan_tour_in_city,
  leadbay_prospecting_overview,
  leadbay_qualify_top_n,
  leadbay_refine_audience,
  leadbay_research_a_domain,
  leadbay_setup_team_prospecting,
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

const CATALOG: CatalogEntry[] = [
  {
    name: "leadbay_daily_check_in",
    description: PROMPT_META.leadbay_daily_check_in.short_description,
    arguments: [],
    render: () => [userMessage(leadbay_daily_check_in)],
  },
  {
    name: "leadbay_prospecting_overview",
    description: PROMPT_META.leadbay_prospecting_overview.short_description,
    arguments: [],
    render: () => [userMessage(leadbay_prospecting_overview)],
  },
  {
    name: "leadbay_research_a_domain",
    description: PROMPT_META.leadbay_research_a_domain.short_description,
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
        substitutePlaceholders(leadbay_research_a_domain, {
          domain: args.domain ?? "<missing>",
        }),
      ),
    ],
  },
  {
    name: "leadbay_import_file",
    description: PROMPT_META.leadbay_import_file.short_description,
    arguments: [
      {
        name: "file",
        description:
          "Path or user-visible name of the CSV/file to import. If omitted, use the file the user attached or referenced.",
        required: false,
      },
      {
        name: "instruction",
        description:
          "Additional user goal, e.g. 'then qualify the leads', 'preserve owner phone as a custom field', or 'only import restaurants in Manhattan'.",
        required: false,
      },
    ],
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
        substitutePlaceholders(leadbay_refine_audience, {
          instruction: args.instruction ?? "<missing>",
        }),
      ),
    ],
  },
  {
    name: "leadbay_log_outreach",
    description: PROMPT_META.leadbay_log_outreach.short_description,
    arguments: [
      {
        name: "lead_id",
        description: "The lead UUID. Get it from leadbay_pull_leads or leadbay_research_lead_by_id.",
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
    arguments: [
      {
        name: "city",
        description:
          "City or region the user is visiting (e.g. 'Limoges', 'Bay Area'). Used as the geo filter for both Monitor and Discover lookups.",
        required: true,
      },
      {
        name: "date",
        description:
          "When the visit is (e.g. 'May 24', 'next Thursday'). Surfaced in the outreach drafts as 'I'll be in <city> on <date>'.",
        required: false,
      },
    ],
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
    arguments: [
      {
        name: "audience",
        description:
          "Optional: a fresh audience to target (e.g. 'dental clinics in Texas'). Omit to build from your ACTIVE lens — the default.",
        required: false,
      },
      {
        name: "campaign_name",
        description:
          "Optional: a name for the campaign. Omit and one is derived from the lens/audience + date (or the backend AI-names it).",
        required: false,
      },
    ],
    render: (args) => [
      userMessage(
        substitutePlaceholders(leadbay_build_campaign, {
          audience_block: args.audience
            ? `Target audience: **${args.audience}** — if my active lens doesn't already cover it, set it up first (confirm before switching lenses).`
            : "Use my active Leadbay lens as the audience.",
          campaign_name_paren: args.campaign_name
            ? ` named **${args.campaign_name}**`
            : "",
        }),
      ),
    ],
  },
  {
    name: "leadbay_setup_team_prospecting",
    description: PROMPT_META.leadbay_setup_team_prospecting.short_description,
    arguments: [
      {
        name: "audience",
        description:
          "Natural-language audience description (e.g. 'plumbing companies with 10-50 employees in Seine-Maritime').",
        required: true,
      },
      {
        name: "rep_split",
        description:
          "Optional: how to split validated leads into per-rep campaigns. Free text (e.g. 'split by city', 'one campaign per rep').",
        required: false,
      },
    ],
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
    arguments: [
      {
        name: "campaign",
        description:
          "Campaign name (fuzzy match) or campaign UUID. Omit to list and pick interactively.",
        required: false,
      },
      {
        name: "mode",
        description:
          "Optional: skip readiness proposal and jump to 'call_sheet', 'email_sheet', 'map', or 'enrich_first'. Omit to let the prompt propose based on campaign data.",
        required: false,
      },
    ],
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
          substitutePlaceholders(leadbay_qualify_top_n, {
            count_or_default: n,
          }),
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
