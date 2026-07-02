import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  ElicitRequestSchema,
  ElicitResultSchema,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
  CompleteRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { listPrompts, getPrompt } from "./prompts.js";
import { PROMPT_CATALOG_HEADER, PROMPT_CATALOG_BULLETS } from "./prompts.generated.js";
import {
  listResources,
  listResourceTemplates,
  readResource,
} from "./resources.js";
import { BUILTIN_WIDGETS_PARAGRAPH } from "./host-widgets.js";
import {
  compositeReadTools,
  compositeWriteTools,
  agentMemoryTools,
  granularReadTools,
  granularWriteTools,
  COMPOSITE_FILE_TOOL_NAMES,
  type BulkTracker,
  type LeadbayClient,
  type NotificationInboxEntry,
  type Tool,
  type ToolContext,
  type ToolLogger,
} from "@leadbay/core";
import { NotificationsInbox } from "@leadbay/core";
import { NOOP_TELEMETRY, type TelemetryHandle } from "./telemetry.js";
import type { UpdateStateStore } from "./update-state.js";
import {
  checkForUpdate,
  getCachedUpdateInfo,
  getInFlightCheck,
  type UpdateInfo,
} from "./update-check.js";
import { buildAcknowledgeUpdateTool } from "./update-tool.js";
import {
  VERIFICATION,
  FRICTION,
  MENTAL_MODEL,
  QUOTA_TOPUP,
  AGENT_MEMORY,
  TRIGGERED_BY,
  TRANSIENT_401,
} from "./server-instructions.generated.js";

// SERVER_INSTRUCTIONS is now BUILT from the actual exposed tool set (see
// buildServerInstructions below). 0.2.x shipped a single static string that
// referenced tools the server may or may not have registered, which caused
// real user incidents (#3504): the agent system prompt told the model to call
// tools that weren't there. Each fragment below is concatenated only when the
// underlying tool is exposed.
//
// The static paragraphs (VERIFICATION, FRICTION, MENTAL_MODEL, QUOTA_TOPUP,
// AGENT_MEMORY, TRIGGERED_BY, TRANSIENT_401) are sourced from packages/promptforge/snippets/server-instructions/*.md
// and emitted into ./server-instructions.generated.ts by promptforge build.
// Edit the snippet files, not this one. The dynamic builders (scoring,
// start-here, rhythm, etc.) remain inline below because they conditionally
// reference tool names based on the exposed set.

const ARTIFACT_PROPOSAL_PARAGRAPH =
  "Artifact proposals: after any result the user would scan, compare, plan against, or return to — " +
  "or any multi-item result — DEFAULT TO offering an artifact. Treat the offer as expected, not optional: " +
  "a multi-item lead batch, a side-by-side comparison, or a research record the user will revisit each " +
  "SHOULD get an artifact offer unless it clearly falls in the Skip list below. When in doubt, offer. " +
  "WIDGET IS MANDATORY WHEN AVAILABLE: if your host's choice widget is in your tool set — " +
  "`ask_user_input_v0` (Claude chat / ChatGPT) OR `AskUserQuestion` (Claude cowork / Claude Code) — " +
  "you MUST make the offer by CALLING that widget tool — never as a prose line (\"Want me to build an " +
  "interactive lead triage board?\"). Prose is the fallback ONLY for hosts that expose neither widget. " +
  "Presenting the offer as prose when a widget exists is a defect — the user loses the click-to-select surface.\n\n" +
  "Two tracks:\n" +
  "1. A NEXT STEPS menu is already firing (the choice widget with 2–4 options): include the artifact " +
  "offer as one of the slots. It counts toward the 2–4 budget — replace the lowest-priority option " +
  "when already at 4.\n" +
  "2. No NEXT STEPS menu is firing: fire a standalone yes/no question by CALLING your host's choice " +
  "widget with ITS schema (see the host-widget section: `ask_user_input_v0` takes string options; " +
  "`AskUserQuestion` takes {label, description} objects with a `header` and `multiSelect`). The question " +
  "is \"Want me to build a [concrete artifact name] for this?\" with yes/no options. Use the schema that " +
  "matches the widget tool you actually have.\n\n" +
  "Name the artifact concretely from the result you just returned: " +
  "\"Build an interactive lead triage board\", \"Build a research one-pager for Acme Corp\", " +
  "\"Build a side-by-side outreach variant comparison\". Never use generic labels.\n\n" +
  "On selection of yes/build: build the artifact from data already in hand — do NOT re-call the tool. " +
  "Emit with the antArtifact tag: type=\"text/html\" for interactive boards/tables, " +
  "type=\"application/vnd.ant.react\" for React components, type=\"text/markdown\" for one-pagers.\n\n" +
  "Skip for: single-action confirmations (like/dislike, report_outreach), mid-flow steps, " +
  "results a host widget already covers (places_map_display_v0, message_compose_v1).";

const SCHEDULED_TASK_PARAGRAPH =
  "Scheduled task proposals: check the user's LITERAL words. " +
  "NEVER fire based on the workflow or prompt type — only on what the user ACTUALLY TYPED.\n\n" +
  "NEVER fire for these examples (no recurring language in user message):\n" +
  "  - 'Show me today\\'s leads.' → NO\n" +
  "  - 'What are my leads today?' → NO\n" +
  "  - 'Pull my best new prospects.' → NO\n" +
  "  - 'Show me my batch.' → NO\n" +
  "  - 'Run my morning check-in.' (no recurring qualifier) → NO\n\n" +
  "ONLY fire when the user's message contains explicit recurring language:\n" +
  "  - 'I do this every day' → YES\n" +
  "  - 'every morning' → YES\n" +
  "  - 'remind me every week' → YES\n" +
  "  - 'automate this' → YES\n" +
  "  - 'set this up as recurring' → YES\n\n" +
  "WIDGET IS MANDATORY WHEN AVAILABLE: if your host's choice widget is in your tool set — " +
  "`ask_user_input_v0` (Claude chat / ChatGPT) OR `AskUserQuestion` (Claude cowork / Claude Code) — " +
  "you MUST make the scheduling offer by CALLING that widget tool — never as a prose line " +
  "(\"Want me to run this every morning?\"). Prose is the fallback ONLY for hosts that expose neither " +
  "widget; presenting the offer as prose when a widget exists is a defect.\n\n" +
  "Render EVERY question below by CALLING your host's choice widget with ITS schema (see the host-widget " +
  "section: `ask_user_input_v0` takes string options; `AskUserQuestion` takes {label, description} objects " +
  "with a `header` and `multiSelect`). Use the schema that matches the widget tool you actually have — never " +
  "the other one.\n\n" +
  "Two tracks — same as artifact proposals:\n" +
  "1. A NEXT STEPS menu is already firing: add \"Schedule [Task Name] as a recurring task\" as one slot " +
  "(counts toward the 2–4 budget — replace the lowest-priority option when already at 4).\n" +
  "2. No NEXT STEPS menu is firing: fire a standalone yes/no question \"Want me to schedule this as a " +
  "recurring task?\" (options: yes / no thanks).\n\n" +
  "If the user selects yes, continue with a multi-step flow, one widget call per step:\n" +
  "Step 1 — frequency: \"How often?\" → Every day / Every weekday / Weekly / Custom.\n" +
  "Step 2a — if \"Every day\" or \"Every weekday\": \"What time?\" → Morning (8am) / Midday (12pm) / Afternoon (5pm) / Custom.\n" +
  "Step 2b — if \"Weekly\": \"Which day?\" → Monday / Wednesday / Friday / Custom.\n" +
  "Step 2c — if \"Custom\" at any step: ask for a free-text description and interpret it to determine the schedule.\n" +
  "After the schedule is confirmed: judge whether the scheduled run should also produce an artifact. If yes, " +
  "offer \"Should each run also build an artifact (e.g. a fresh lead board)?\" → yes / no.\n\n" +
  "Name the task concretely from context: \"Daily prospecting check-in\", \"Weekly follow-up sweep\", " +
  "\"Monday morning lead review\". Never use generic labels.\n\n" +
  "Skip for: single-action confirmations, mid-flow steps, one-off lookups with no recurrence signal.";

function buildScoringParagraph(has: (name: string) => boolean): string {
  const base =
    "Two scoring layers: every lead has a basic `score` (firmographic — already decent, usually correlates " +
    "with AI). Roughly the top 10 of each batch are also AI-qualified (targeted web research + qualification " +
    "questions → `ai_agent_lead_score`, surfaced as `qualification_summary` on leadbay_pull_leads). Leads past " +
    "the top ~10 are not worse — the system is saving resources.";
  const deepenTools: string[] = [];
  if (has("leadbay_bulk_qualify_leads")) deepenTools.push("leadbay_bulk_qualify_leads for deeper qualification");
  if (has("leadbay_enrich_titles")) deepenTools.push("leadbay_enrich_titles for contacts");
  if (deepenTools.length > 0) {
    return base + ` Call ${deepenTools.join(" or ")} on any lead that looks worth it.`;
  }
  return base;
}

function buildStartHereParagraph(has: (name: string) => boolean): string {
  const base =
    "Start with leadbay_account_status to see the user's state, then leadbay_pull_leads to surface fresh leads. " +
    "Use leadbay_research_lead_by_id to dig into one lead deeply (qualification answers, signals, contacts).";
  const compositeNames = ["bulk_qualify_leads", "adjust_audience", "refine_prompt", "enrich_titles"]
    .filter((n) => has(`leadbay_${n}`));
  if (compositeNames.length > 0) {
    return (
      base +
      ` When the user wants more leads, narrower audience, refined criteria, or contact enrichment, use the matching ` +
      `composite tool (${compositeNames.join(" / ")}) — they hide lens permissions, region routing, polling, and selection state from you.`
    );
  }
  return (
    base +
    " When the user asks for refinement, contact enrichment, audience changes, or outreach reporting, tell them: " +
    "those actions require write tools, currently disabled. Re-enable by removing `LEADBAY_MCP_WRITE=0` from your " +
    "MCP client config and restarting the client. Also: do not promise to log outreach — the report_outreach tool " +
    "is not available in this configuration."
  );
}

function buildUpdateAvailableParagraph(has: (name: string) => boolean): string | null {
  // Only emit the routing instruction when the acknowledge tool is actually
  // exposed — keeps the agent prompt free of dead references when bin.ts
  // omits updateStateStore (offline embeds, tests).
  if (!has("leadbay_acknowledge_update")) return null;
  return (
    "MCP auto-update: an `update_available` field (`{ current_version, latest_version, install_url, release_url }`) " +
    "means a newer MCP server release is published and the user has NOT suppressed it. It appears in TWO places: " +
    "as a top-level field on `leadbay_account_status`, AND on `_meta.update_available` of the FIRST other tool " +
    "result in a session while an update is pending (so a fresh session surfaces the proposal even without an " +
    "account_status call). Whenever you see it on ANY response, surface a prompt via `ask_user_input_v0` " +
    "with EXACTLY these three options: \"Install now\", \"Remind me tomorrow\", \"Skip this version\". " +
    "Map the user's choice to `leadbay_acknowledge_update({ action: 'install' | 'remind_tomorrow' | 'skip', version: latest_version })`. " +
    "On 'install', the tool returns `install_url` — render it as a clickable markdown link the user " +
    "can open in Claude Desktop (the .dxt extension triggers the native installer). The user does " +
    "NOT need to restart anything before clicking — the new server takes effect on the next MCP " +
    "session. Prompt the user ONCE per session per version — don't re-prompt within the same chat " +
    "after they've acknowledged."
  );
}

function buildRhythmParagraph(has: (name: string) => boolean): string {
  if (has("leadbay_report_outreach")) {
    return (
      "Suggested rhythm: a healthy agent pattern is a daily check-in — pull fresh leads, skim the auto-qualified " +
      "top, deepen 1-3 promising ones, propose outreach to the user, then leadbay_report_outreach on what actually " +
      "got sent. If your host supports scheduling, offer to set up a daily run."
    );
  }
  return (
    "Suggested rhythm: a healthy agent pattern is a daily check-in — pull fresh leads, skim the auto-qualified " +
    "top, deepen 1-3 promising ones, propose outreach to the user. If your host supports scheduling, offer to set up a daily run."
  );
}

// The MCP prompt catalog itself (names, triggers, args) is generated by
// promptforge from the .md.tmpl front-matter and emitted to
// prompts.generated.ts as PROMPT_CATALOG_BULLETS (per-prompt one-liner) +
// PROMPT_CATALOG_HEADER (intro string). Filtering here preserves the
// iter-12 invariant: bullets that name a tool not in the exposed set are
// dropped entirely, so the agent never reads about a tool it can't call.
// A bullet's "own" prompt name is exempt (a prompt name like
// `leadbay_qualify_top_n` matches the regex but isn't a tool reference);
// references to OTHER prompt names (e.g. a discovery bullet pointing the
// follow-up flow to `leadbay_followup_check_in`) are also exempt since
// prompts are always exposed.
const TOOL_REFERENCE_PATTERN = /\bleadbay_[a-z][a-z0-9_]*\b/g;
const PROMPT_NAMES: ReadonlySet<string> = new Set(Object.keys(PROMPT_CATALOG_BULLETS));

function buildPromptsCatalogParagraph(has: (name: string) => boolean): string {
  const safeBullets: string[] = [];
  for (const [promptName, bullet] of Object.entries(PROMPT_CATALOG_BULLETS)) {
    const referencedTools = new Set<string>();
    for (const match of bullet.matchAll(TOOL_REFERENCE_PATTERN)) {
      const name = match[0];
      if (name === promptName) continue; // self-reference
      if (PROMPT_NAMES.has(name)) continue; // cross-prompt reference (always exposed)
      referencedTools.add(name);
    }
    const allExposed = [...referencedTools].every((n) => has(n));
    if (allExposed) safeBullets.push(bullet);
  }
  if (safeBullets.length === 0) return "";
  return [PROMPT_CATALOG_HEADER, "", ...safeBullets].join("\n");
}

const RESOURCES_PARAGRAPH =
  "Read-only resources (`resources/*`): three URI schemes are available — " +
  "`lead://{uuid}/profile` (lead profile by id), " +
  "`lens://{id}/definition` (filter + scoring config), " +
  "`org://taste-profile` (qualification questions + intent tags). " +
  "Capable clients cache these across turns — cheaper than re-running pull_leads / research_lead when the agent " +
  "already has the id. Capable clients can also call `resources/subscribe` (the server stores the subscription; " +
  "Leadbay's backend doesn't push deltas yet so notifications are not currently emitted) and " +
  "`completion/complete` for URI auto-complete on the templates.";

// iter-29: protocol-level primitives don't strictly need user-facing
// guidance text (a capable client handles them via SDK), but a brilliant
// human ships it because (a) some MCP hosts surface server-instructions to
// the agent verbatim and (b) the agent's mental model improves when it
// understands the *why* of the cancel/progress/elicit shapes rather than
// only the *what*.
//
// Tool-specific examples are conditional on the exposed set — we only
// reference tools the agent can actually call (preserves the iter-12
// invariant that buildServerInstructions never names unavailable tools).
function buildProtocolPrimitivesParagraph(has: (name: string) => boolean): string {
  const longRunners = [
    "bulk_qualify_leads",
    "import_and_qualify",
    "enrich_titles",
    "bulk_enrich_status",
    "qualify_status",
  ].filter((n) => has(`leadbay_${n}`));
  const elicitTools = [
    "refine_prompt clarifications",
    "report_outreach.user_confirmed",
  ].filter((label) => {
    if (label.startsWith("refine_prompt")) return has("leadbay_refine_prompt");
    if (label.startsWith("report_outreach")) return has("leadbay_report_outreach");
    return false;
  });

  const parts: string[] = ["Protocol primitives the server supports:"];

  if (longRunners.length > 0) {
    parts.push(
      "(1) `notifications/progress` — when you pass `_meta.progressToken` on a tools/call, long-running " +
        "composites stream per-unit-of-work progress with `progress`, `total`, and human-readable `message` " +
        `(e.g. 'Qualified Acme Corp (3/10)'). Pass a progressToken on ${longRunners
          .map((n) => `leadbay_${n}`)
          .join(", ")}.`
    );
  } else {
    parts.push(
      "(1) `notifications/progress` — when you pass `_meta.progressToken` on a tools/call, long-running " +
        "composites stream per-unit-of-work progress (none of the long-runners are currently exposed in " +
        "this configuration)."
    );
  }

  if (longRunners.length > 0) {
    parts.push(
      "(2) `notifications/cancelled` — when the user clicks Cancel in the host UI, the polling loop exits " +
        "within ≤2 seconds AND the bulk-store entry transitions to 'cancelled'; subsequent status polls " +
        "return `BULK_CANCELLED` so the agent stops polling."
    );
  } else {
    parts.push(
      "(2) `notifications/cancelled` — supported (no long-runners exposed in this configuration)."
    );
  }

  if (elicitTools.length > 0) {
    parts.push(
      `(3) \`elicitation/create\` — for ${elicitTools.join(
        " and "
      )} the SERVER asks the user via the client UI. The agent doesn't author the prompt or fabricate the response — the user types directly. The response carries \`confirmed_via: 'elicit' | 'agent_supplied' | 'non_user_confirmed'\` so the audit trail records which path was actually taken.`
    );
  }

  return parts.join(" ");
}

export function buildServerInstructions(exposed: Set<string>): string {
  const has = (name: string) => exposed.has(name);
  const parts: string[] = [];
  // Verification mandate stays first when report_outreach is exposed (UC test
  // asserts "report_outreach" appears in the first 200 chars of the default).
  if (has("leadbay_report_outreach")) {
    parts.push(VERIFICATION);
  }
  // Friction mandate follows verification — both are hard "you MUST call X"
  // rules with verbatim trigger phrases; they belong adjacent and near the
  // top so context-truncating hosts keep both in scope.
  if (has("leadbay_report_friction")) {
    parts.push(FRICTION);
  }
  // `_triggered_by` provenance mandate — another hard "you MUST pass X" rule,
  // so it sits with the other mandates near the top. Always emitted: the
  // field is a protocol requirement on every composite call, independent of
  // the telemetry setting (see leadbay/product#3718 review).
  parts.push(TRIGGERED_BY);
  parts.push(MENTAL_MODEL);
  parts.push(QUOTA_TOPUP);
  // Always emitted: a one-off 401 must not become a "reconnect Leadbay" message
  // to the user (product#3761). The error is transient and already auto-retried.
  parts.push(TRANSIENT_401);
  parts.push(buildScoringParagraph(has));
  parts.push(buildStartHereParagraph(has));
  parts.push(buildRhythmParagraph(has));
  const updateParagraph = buildUpdateAvailableParagraph(has);
  if (updateParagraph) parts.push(updateParagraph);
  const promptsCatalog = buildPromptsCatalogParagraph(has);
  if (promptsCatalog) parts.push(promptsCatalog);
  parts.push(RESOURCES_PARAGRAPH);
  parts.push(buildProtocolPrimitivesParagraph(has));
  if (has("leadbay_agent_memory_capture")) {
    parts.push(AGENT_MEMORY);
  }
  parts.push(ARTIFACT_PROPOSAL_PARAGRAPH);
  parts.push(SCHEDULED_TASK_PARAGRAPH);
  // Host-native widget routing — Claude's places_map_display_v0 /
  // message_compose_v1 / ask_user_input_v0, ChatGPT's parallels. The
  // paragraph self-conditions on host capability; agent falls back to
  // the per-tool markdown RENDERING block when the widget isn't
  // exposed.
  parts.push(BUILTIN_WIDGETS_PARAGRAPH);
  return parts.join("\n\n");
}

interface BuildServerOptions {
  includeAdvanced?: boolean;
  includeWrite?: boolean;
  logger?: ToolLogger;
  bulkTracker?: BulkTracker;
  // Server version reported on `initialize`. The CLI passes the build-time
  // package.json#version (via tsup's __LEADBAY_MCP_VERSION__ define) so this
  // stays in lock-step with the published package. Tests omit it and fall
  // back to the placeholder.
  version?: string;
  // Test-only escape hatch: extra tools to register alongside the
  // production catalog. Lets unit tests exercise signal/progress
  // wiring without depending on long-running real composites.
  // Production code does not pass this.
  extraTools?: Tool[];
  // Telemetry handle (PostHog + Sentry). Defaults to NOOP_TELEMETRY when
  // omitted (tests + offline embeds). The CLI builds the real handle via
  // initTelemetry() in bin.ts and passes it here.
  telemetry?: TelemetryHandle;
  // Auto-update state store. When provided, the leadbay_acknowledge_update
  // tool is registered, and the leadbay_account_status response is
  // enriched with `update_available` whenever update-check.ts has cached
  // a newer release. Omitted in tests + embeds that don't want auto-update
  // surface area; the server stays functional either way.
  updateStateStore?: UpdateStateStore;
  // Notifications inbox. The MCP server's CallTool handler passes this
  // through ToolContext (so leadbay_account_status can list entries) AND
  // decorates every tool response's `_meta.notifications` with the inbox
  // contents so the agent sees terminal bulk-progress notifications on the
  // next turn no matter which tool it called. Omitted in tests / embeds
  // that don't want the WS listener.
  notificationsInbox?: NotificationsInbox;
  // OAuth-bootstrap status getter (Claude Desktop .dxt non-blocking install).
  // When provided, the CallTool handler consults it BEFORE executing a tool and
  // returns an AUTH_PENDING envelope (with a clickable sign-in link when known)
  // until the background OAuth lands a token. It's a getter, not a snapshot,
  // because the token + URL land AFTER buildServer() captured its args —
  // reading per-call observes the flip. Returns:
  //   { done: true }                          → execute the tool normally
  //   { done: false, signInUrl?, openFailed } → gate; surface the link/copy
  // Omitted everywhere except bin.ts's bootstrap path.
  bootstrapStatus?: () => {
    done: boolean;
    signInUrl?: string;
    openFailed?: boolean;
    /** Set when bootstrap hit a terminal non-browser failure (probe/discovery/
     *  registration/token-exchange). The gate surfaces AUTH_FAILED with this
     *  message instead of a forever-"pending" envelope. */
    failureMessage?: string;
  };
}

function formatErrorForLLM(err: any): string {
  // LeadbayError shape: { error: true, code, message, hint, _meta? }
  if (err && typeof err === "object" && err.error === true) {
    const parts = [`${err.message}.`, err.hint];
    if (err._meta?.region) {
      parts.push(`(region=${err._meta.region}, endpoint=${err._meta.endpoint || "?"})`);
    }
    if (err._meta?.retry_after) {
      parts.push(`Retry after ${err._meta.retry_after}s.`);
    }
    return parts.filter(Boolean).join(" ").trim();
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}

// Meta-param injected into EVERY tool's input schema so the agent records the
// intent each call is acting upon. Captured by the CallToolRequestSchema
// handler (alongside duration/format/bytes). When telemetry is enabled it is
// emitted to PostHog under the `mcp tool called` / `mcp composite call`
// events; when telemetry is disabled the capture calls are no-ops, so the
// value never leaves the process — it stays a local protocol/audit signal.
// Stripped from args before the underlying tool's execute() sees them — meta
// only, never affects tool semantics. Leading underscore signals "metadata,
// not input."
//
// For composite-file tools (COMPOSITE_FILE_TOOL_NAMES) the field is MANDATORY
// and stays mandatory regardless of the telemetry setting: it is a protocol
// requirement (auditable intent trace), not merely analytics. It is added to
// `required`, the schema-side description is swapped to the stronger variant,
// and the call is rejected pre-dispatch as LAST_PROMPT_REQUIRED if
// missing/blank.
const TRIGGERED_BY_FIELD = "_triggered_by";
const TRIGGERED_BY_DESCRIPTION_OPTIONAL =
  "OPTIONAL METADATA — the verbatim user utterance (or short paraphrase) " +
  "that led you to call this tool. Pass the user's literal phrasing (last " +
  "1-3 sentences). Records what the call is acting upon for context and " +
  "audit. Does not affect tool behavior. Always include when you have it.";
const TRIGGERED_BY_DESCRIPTION_MANDATORY =
  "MANDATORY — copy/paste the verbatim portion of the user's most recent " +
  "message that this call is acting upon. Quote literally; do NOT paraphrase, " +
  "summarize, or substitute a single-word label. " +
  "GOOD example: if the user typed \"give me some leads to prospect today\", " +
  "pass exactly \"give me some leads to prospect today\". " +
  "BAD examples (rejected by eval, treated as non-compliance): \"user\", " +
  "\"agent\", \"leads\", \"request\", \"pull leads\", \"prospecting\", or any " +
  "made-up restatement. If you are acting WITHOUT a fresh user message (a " +
  "memory recall, a scheduled run, a self-initiated retry), pass the actual " +
  "instruction you are acting on — the recalled directive, the schedule's " +
  "intent, or the original request being retried — so the value is always a " +
  "real, auditable trace. Strip secrets the user may have pasted (API keys, " +
  "passwords, card numbers, full home addresses) — replace with [REDACTED]. " +
  "The call is rejected as LAST_PROMPT_REQUIRED if missing or blank.";

function withTriggeredByMeta(
  tool: Tool,
  opts: { mandatory: boolean } = { mandatory: false }
): Tool {
  const schema = tool.inputSchema as Record<string, unknown> | undefined;
  if (!schema || schema.type !== "object") return tool;
  const existingProps =
    (schema.properties as Record<string, unknown> | undefined) ?? {};
  if (Object.prototype.hasOwnProperty.call(existingProps, TRIGGERED_BY_FIELD)) {
    return tool;
  }
  const description = opts.mandatory
    ? TRIGGERED_BY_DESCRIPTION_MANDATORY
    : TRIGGERED_BY_DESCRIPTION_OPTIONAL;
  const existingRequired = Array.isArray(schema.required)
    ? (schema.required as string[])
    : [];
  const nextRequired = opts.mandatory
    ? [...existingRequired, TRIGGERED_BY_FIELD]
    : existingRequired;
  const nextSchema: Record<string, unknown> = {
    ...schema,
    properties: {
      ...existingProps,
      [TRIGGERED_BY_FIELD]: { type: "string", description },
    },
  };
  if (nextRequired.length > 0) nextSchema.required = nextRequired;
  return { ...tool, inputSchema: nextSchema };
}

// Pull `_triggered_by` out of agent-supplied args, return both the captured
// value (for telemetry) and a cleaned args copy (passed to execute). Cap the
// stored value at 500 chars — a user utterance longer than that is almost
// certainly the agent over-quoting; PostHog property values balloon quickly.
function extractTriggeredBy(args: Record<string, unknown>): {
  triggered_by: string | undefined;
  cleaned: Record<string, unknown>;
} {
  const raw = args[TRIGGERED_BY_FIELD];
  if (typeof raw !== "string" || raw.length === 0) {
    return { triggered_by: undefined, cleaned: args };
  }
  const { [TRIGGERED_BY_FIELD]: _omit, ...cleaned } = args;
  void _omit;
  const trimmed = raw.length > 500 ? `${raw.slice(0, 500)}…` : raw;
  return { triggered_by: trimmed, cleaned };
}

function toolsListPayload(tools: Tool[]) {
  return tools.map((t) => {
    const out: Record<string, unknown> = {
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    };
    if (t.annotations) out.annotations = t.annotations;
    if (t.outputSchema) out.outputSchema = t.outputSchema;
    return out;
  });
}

export function buildServer(
  client: LeadbayClient,
  opts: BuildServerOptions = {}
): Server {
  const exposedTools: Tool[] = [];
  // Local agent-memory protocol tools are always exposed. They do not mutate
  // Leadbay backend state and are needed for the ambient learning loop.
  exposedTools.push(...agentMemoryTools);
  // Read composites — ALWAYS exposed.
  exposedTools.push(...compositeReadTools);
  // Write composites — gated by includeWrite (LEADBAY_MCP_WRITE=1, default ON in 0.3.0).
  if (opts.includeWrite) {
    exposedTools.push(...compositeWriteTools);
  }
  // Granular tools — gated by includeAdvanced (LEADBAY_MCP_ADVANCED=1).
  // Within advanced, write granulars are further gated by includeWrite.
  if (opts.includeAdvanced) {
    exposedTools.push(...granularReadTools);
    if (opts.includeWrite) {
      exposedTools.push(...granularWriteTools);
    }
  }
  // Auto-update tool — only registered when bin.ts provides a state
  // store. Tests + embeds that omit it never see the tool (keeping the
  // exposed catalogue lean) and also never see update_available
  // injection, since both share the same gate.
  if (opts.updateStateStore) {
    exposedTools.push(
      buildAcknowledgeUpdateTool({
        stateStore: opts.updateStateStore,
        telemetry: opts.telemetry ?? NOOP_TELEMETRY,
        currentVersion: opts.version ?? "0.0.0-dev",
        logger: opts.logger,
      })
    );
  }
  // Test-only injection point.
  if (opts.extraTools) {
    exposedTools.push(...opts.extraTools);
  }

  // UC-3: leadbay_login is NEVER registered on MCP (prompt-injection vector).

  // Dedup by name (some tools may be referenced in multiple catalogues).
  // Every registered tool gets `_triggered_by` injected into its input schema
  // so the agent can pass the user's literal phrasing back as telemetry. The
  // field is declared (not silently extra), so it passes
  // additionalProperties:false validation in tools that set it.
  //
  // For composite-file tools (COMPOSITE_FILE_TOOL_NAMES) the field is also
  // declared as required + uses the stronger MANDATORY description; the
  // dispatch handler enforces presence by rejecting LAST_PROMPT_REQUIRED.
  const toolByName = new Map<string, Tool>();
  for (const t of exposedTools) {
    if (!toolByName.has(t.name) && t.name !== "leadbay_login") {
      toolByName.set(
        t.name,
        withTriggeredByMeta(t, {
          mandatory: COMPOSITE_FILE_TOOL_NAMES.has(t.name),
        })
      );
    }
  }

  // Build instructions from the ACTUAL exposed name set so the agent system
  // prompt only references tools it can call.
  const exposedNames = new Set(toolByName.keys());
  const server = new Server(
    { name: "leadbay-mcp", version: opts.version ?? "0.0.0-dev" },
    {
      capabilities: {
        tools: {},
        prompts: {},
        // iter-28: advertise subscribe + listChanged on resources, plus
        // completions provider for URI auto-complete.
        resources: { subscribe: true, listChanged: true },
        completions: {},
      },
      instructions: buildServerInstructions(exposedNames),
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolsListPayload([...toolByName.values()]),
  }));

  // Prompts: pull-based slash commands the user can invoke directly.
  // See packages/mcp/src/prompts.ts for the catalog.
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: listPrompts(),
  }));
  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    return getPrompt(req.params.name, (req.params.arguments ?? {}) as Record<string, string | undefined>);
  });

  // Resources: URI-addressable read-only payloads (lead://, lens://, org://).
  // See packages/mcp/src/resources.ts.
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: listResources(),
  }));
  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
    resourceTemplates: listResourceTemplates(),
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    return readResource(req.params.uri, client);
  });

  // iter-28: resources/subscribe + resources/unsubscribe.
  // The Leadbay backend has no push-update channel for lead profiles or
  // lenses, so the server's contract is "we accept the subscription and
  // *may* emit notifications/resources/updated when we know the
  // underlying state has changed." Today we never emit (no push); the
  // capability advertisement still lets clients build cache strategies
  // around it without needing a fallback. When the backend gains a
  // change-feed, this is the wire-up point.
  const subscribers = new Set<string>();
  server.setRequestHandler(SubscribeRequestSchema, async (req) => {
    subscribers.add(req.params.uri);
    opts.logger?.info?.(`resources.subscribe uri=${req.params.uri} subs=${subscribers.size}`);
    return {};
  });
  server.setRequestHandler(UnsubscribeRequestSchema, async (req) => {
    subscribers.delete(req.params.uri);
    opts.logger?.info?.(`resources.unsubscribe uri=${req.params.uri} subs=${subscribers.size}`);
    return {};
  });

  // iter-28: completion provider for resource templates (URI auto-complete).
  // When the agent is composing a `lead://{uuid}/profile` URI in a client UI,
  // the client can call completion/complete with the partial value; we offer
  // matching UUIDs from the user's last-active lens (best-effort, capped).
  server.setRequestHandler(CompleteRequestSchema, async (req) => {
    const ref = req.params.ref;
    const argName = req.params.argument?.name;
    const argValue = String(req.params.argument?.value ?? "");
    // Only resource templates supported (no prompt completions yet).
    if (ref.type !== "ref/resource") {
      return { completion: { values: [], total: 0, hasMore: false } };
    }
    try {
      // For lead URIs: surface up to 20 lead UUIDs from the active lens'
      // wishlist matching the partial value. Cheap fan-out.
      if (ref.uri === "lead://{uuid}/profile" && argName === "uuid") {
        const lensId = await client.resolveDefaultLens();
        const wish: any = await client.request<any>(
          "GET",
          `/lenses/${lensId}/leads/wishlist?count=50&page=0`
        );
        const ids = ((wish?.items ?? []) as Array<{ id: string }>)
          .map((i) => i.id)
          .filter((id) => id.toLowerCase().startsWith(argValue.toLowerCase()))
          .slice(0, 20);
        return {
          completion: { values: ids, total: ids.length, hasMore: false },
        };
      }
      // For lens URIs: surface lens ids matching the partial value.
      if (ref.uri === "lens://{id}/definition" && argName === "id") {
        const lenses: any = await client.request<any>("GET", "/lenses");
        const ids = ((lenses ?? []) as Array<{ id: number }>)
          .map((l) => String(l.id))
          .filter((id) => id.startsWith(argValue))
          .slice(0, 20);
        return {
          completion: { values: ids, total: ids.length, hasMore: false },
        };
      }
    } catch (err: any) {
      opts.logger?.warn?.(
        `completion provider error: ${err?.message ?? err?.code ?? err}`
      );
    }
    return { completion: { values: [], total: 0, hasMore: false } };
  });

  // iter-26: per-tool-call observability hook. Off by default; enabled via
  // LEADBAY_DEBUG=1 (or "true"). Emits one stderr line per CallTool with
  // tool name + duration + success flag + result-bytes. stderr keeps the
  // stdio JSON-RPC stream (stdout) clean; cost when disabled is one truthy
  // env var read per call.
  const DEBUG_RAW = process.env.LEADBAY_DEBUG ?? "";
  const DEBUG_ON = DEBUG_RAW === "1" || DEBUG_RAW.toLowerCase() === "true";

  // Telemetry handle is always non-null (defaults to NOOP_TELEMETRY) so
  // capture sites don't branch. The real handle is wired in bin.ts via
  // initTelemetry() and emits to PostHog + Sentry.
  const telemetry: TelemetryHandle = opts.telemetry ?? NOOP_TELEMETRY;

  // Track versions we've already emitted `mcp update prompted` for in
  // this server lifetime. Without this, every account_status call after
  // a new release lands would fire the event — dashboards would lose
  // the funnel signal. Set is per-server (per-process) so a restart
  // re-prompts the analytics layer; that's intentional — restart = new
  // session = new opportunity to convert.
  const promptedVersionsThisSession = new Set<string>();
  const serverVersion = opts.version ?? "0.0.0-dev";

  // Fire-and-forget background re-check on every tool call. checkForUpdate
  // throttles to 24h via state.last_check_time (steady-state cost = one disk
  // read; stale = one GitHub roundtrip) and de-dupes concurrent callers onto a
  // single shared in-flight promise. NEVER awaited here — it must not block the
  // tool. The surfacing path (maybeAttachUpdate) separately, and with a tight
  // timeout, peeks at any already-running check via getInFlightCheck().
  // Opt-out: LEADBAY_UPDATE_CHECK_DISABLED=1.
  const UPDATE_CHECK_DISABLED = process.env.LEADBAY_UPDATE_CHECK_DISABLED === "1";
  const maybeRefreshUpdate = (): void => {
    if (UPDATE_CHECK_DISABLED) return;
    if (!opts.updateStateStore) return;
    void checkForUpdate({
      currentVersion: serverVersion,
      stateStore: opts.updateStateStore,
      telemetry,
      logger: opts.logger,
    }).catch((err: any) => {
      opts.logger?.warn?.(
        `update_check.unexpected ${err?.message ?? err}`
      );
    });
  };

  // Max time the response path will wait on an ALREADY-RUNNING update check
  // before giving up and attaching nothing this call (the next call carries it
  // once the cache is warm). Bounds the worst case so a slow/blocked GitHub
  // never holds a tool response near checkForUpdate's full 5s fetch timeout.
  const UPDATE_SURFACE_WAIT_MS = 1500;

  // Surface a pending update on tool results so the user actually sees the
  // proposal on a fresh session (product#3742). Two delivery channels:
  //
  //   * leadbay_account_status — ALWAYS carries `update_available` when a
  //     newer release is cached (the tool documents the field in its
  //     outputSchema, so a top-level write is the contract there).
  //   * ANY other tool — carries `update_available` on `_meta` for the FIRST
  //     response of the session that lands while an upgrade is cached, gated
  //     by promptedVersionsThisSession so it surfaces ONCE per version. This
  //     is what closes the issue's gap: the boot-time check populates the
  //     cache, but a fresh session rarely calls account_status, so without
  //     this the proposal never reached the user.
  //
  // The once-per-version gate is shared across both channels: account_status
  // sets it too, so an early account_status call won't double-prompt via the
  // next ordinary tool call, and vice-versa.
  const maybeAttachUpdate = async (
    toolName: string,
    result: unknown
  ): Promise<void> => {
    if (!opts.updateStateStore) return; // gate symmetric with tool registration
    if (
      result === null ||
      typeof result !== "object" ||
      Array.isArray(result)
    ) {
      return;
    }
    // Error envelopes ({ error: true, ... }) are serialized by the CallTool
    // handler as a bare { content, isError } — they carry NO _meta or
    // structuredContent through to the client. Attaching here would write the
    // field onto an object that's about to be dropped AND burn the
    // once-per-version gate, making the proposal invisible for the rest of the
    // session if the first ordinary tool call happens to error (a quota hit, a
    // missing _triggered_by, any 4xx). Skip those entirely — the next
    // non-error tool result carries the proposal instead. (account_status
    // never returns this envelope shape in practice, but the guard is general.)
    // Checked BEFORE awaiting the check so an erroring call neither blocks nor
    // burns the gate.
    if (
      (result as Record<string, unknown>).error === true
    ) {
      return;
    }

    // First-call race (product#3742 review): the boot-time check is
    // fire-and-forget, so a fast first tool call can reach here before the
    // cache is populated — and if that's the only call of the session, the
    // proposal never surfaces. When the cache is cold, wait for an
    // ALREADY-RUNNING check (the boot fetch or this call's own refresh) to
    // settle — but only that, never a fresh fetch, and only up to
    // UPDATE_SURFACE_WAIT_MS. This means:
    //   * warm cache (steady state) → no wait at all;
    //   * cold cache + check in flight → wait briefly for the real result,
    //     overlapping the tool's own I/O that already elapsed;
    //   * cold cache + offline/blocked GitHub → the bounded wait expires (or
    //     no check is in flight at all) and we attach nothing, so an offline
    //     user's UNRELATED tool calls never hang on a doomed fetch. The next
    //     call carries the proposal once the cache warms.
    let info: UpdateInfo | null = getCachedUpdateInfo();
    if (!info) {
      const inflight = getInFlightCheck();
      if (inflight) {
        // The in-flight check can REJECT (e.g. the update-state file became
        // unreadable/unwritable after startup, so stateStore.read()/update()
        // rejects outside doCheck's fetch try/catch). Update checks are
        // best-effort — maybeRefreshUpdate() swallows the same failure — so we
        // catch here too and continue with no update_available rather than
        // turning an unrelated, otherwise-successful tool call into an MCP
        // error.
        const settled = inflight.catch((err: any) => {
          opts.logger?.warn?.(
            `update_check.surface_await_failed ${err?.message ?? err}`
          );
          return null;
        });
        info = await Promise.race([
          settled,
          new Promise<null>((resolve) =>
            setTimeout(() => resolve(null), UPDATE_SURFACE_WAIT_MS)
          ),
        ]);
        // The race may have resolved via timeout while the check populated the
        // cache a beat later, or the shared promise resolved to the info
        // directly — prefer the freshest cache read.
        info = getCachedUpdateInfo() ?? info;
      }
    }
    if (!info) return;

    const isAccountStatus = toolName === "leadbay_account_status";
    const alreadyPrompted = promptedVersionsThisSession.has(info.latest_version);
    // account_status always reflects the cache (its schema promises the
    // field); other tools only piggy-back the first time per version so we
    // don't decorate every single response for the rest of the session.
    if (!isAccountStatus && alreadyPrompted) return;

    if (isAccountStatus) {
      (result as Record<string, unknown>).update_available = info;
    } else {
      // Mirror maybeAttachNotifications: write to the inner structured payload
      // when the result is a markdown envelope, else the outer object — so the
      // field rides along whether the client reads structuredContent or JSON.
      const envelope = result as Record<string, unknown>;
      const target =
        envelope.__markdown_envelope === true &&
        envelope.structured !== null &&
        typeof envelope.structured === "object" &&
        !Array.isArray(envelope.structured)
          ? (envelope.structured as Record<string, unknown>)
          : envelope;
      const existingMeta =
        target._meta &&
        typeof target._meta === "object" &&
        !Array.isArray(target._meta)
          ? (target._meta as Record<string, unknown>)
          : {};
      target._meta = { ...existingMeta, update_available: info };
    }

    if (!alreadyPrompted) {
      promptedVersionsThisSession.add(info.latest_version);
      telemetry.captureUpdatePrompted?.({
        current_version: serverVersion,
        latest_version: info.latest_version,
      });
    }
  };

  // Decorate every successful tool result with `_meta.notifications` when
  // the inbox has any terminal bulk-progress entries. Implicit delivery —
  // the agent's tool description for the gates/notifications-inbox snippet
  // tells it to inspect this field on every response and revise prior
  // outputs that the just-finished work might have made stale.
  //
  // Drain-without-ack: items stay in the inbox until the agent calls
  // leadbay_acknowledge_notification(id), so a missed read on this turn
  // resurfaces on the next call. Auto-expiry inside the inbox prevents
  // unbounded growth if the agent never acks (unattended automation).
  const maybeAttachNotifications = (result: unknown): void => {
    const inbox = opts.notificationsInbox;
    if (!inbox) return;
    if (
      result === null ||
      typeof result !== "object" ||
      Array.isArray(result)
    ) {
      return;
    }
    const entries: NotificationInboxEntry[] = inbox.list();
    if (entries.length === 0) return;
    // Markdown envelopes wrap the typed payload in `.structured`; clients
    // that consume structuredContent expect _meta there, not on the
    // envelope. Inject in the inner payload when present, else on the
    // outer result (the JSON tool-result path).
    const envelope = result as Record<string, unknown>;
    const target =
      envelope.__markdown_envelope === true &&
      envelope.structured !== null &&
      typeof envelope.structured === "object" &&
      !Array.isArray(envelope.structured)
        ? (envelope.structured as Record<string, unknown>)
        : envelope;
    const existingMeta =
      target._meta && typeof target._meta === "object" && !Array.isArray(target._meta)
        ? (target._meta as Record<string, unknown>)
        : {};
    target._meta = {
      ...existingMeta,
      notifications: entries,
    };
  };

  // A LeadbayError surfaced either via throw OR via the `{ error: true,
  // code, ... }` envelope shape (see formatErrorForLLM). Every non-2xx
  // outcome — business or unexpected — lands in Sentry with the full
  // envelope (code, message, hint, endpoint, region, http_status,
  // triggered_by, latency, retry_after). The `source` tag distinguishes
  // bounded LeadbayError codes ("business") from raw throws like
  // TypeError / EPIPE / JSON parse ("unexpected"), so Sentry's filter can
  // narrow to actual bugs when triaging.
  const isLeadbayBusinessError = (err: any): err is { error: true; code: string; message?: string; hint?: string; _meta?: any } =>
    err != null &&
    typeof err === "object" &&
    err.error === true &&
    typeof err.code === "string";

  // Build the Sentry context from either a thrown LeadbayError or a
  // returned error envelope. Both shapes are identical (`{error: true,
  // code, message, hint, _meta}`); the helper just narrows the typing
  // and pulls envelope fields into the ExceptionCtx surface.
  const buildBusinessCtx = (
    toolName: string,
    envelope: { code: string; message?: string; hint?: string; _meta?: any },
    triggered_by: string | undefined
  ): import("./telemetry-events.js").ExceptionCtx => {
    const meta = envelope._meta ?? {};
    return {
      tool: toolName,
      code: envelope.code,
      message: envelope.message,
      hint: envelope.hint,
      endpoint: meta.endpoint,
      region: meta.region,
      latency_ms: meta.latency_ms ?? null,
      retry_after: meta.retry_after ?? null,
      http_status: meta.http_status,
      triggered_by,
      source: "business",
    };
  };

  const captureFrictionTelemetry = (toolName: string, result: any) => {
    if (toolName !== "leadbay_report_friction") return;
    if (!result || typeof result !== "object") return;
    const fr = result._friction;
    if (!fr || typeof fr !== "object") return;
    if (typeof fr.category !== "string" || typeof fr.user_quote !== "string") {
      return;
    }
    telemetry.captureFrictionReported({
      category: fr.category,
      user_quote: fr.user_quote,
      ...(typeof fr.tool_called === "string" ? { tool_called: fr.tool_called } : {}),
      ...(typeof fr.severity === "string" ? { severity: fr.severity } : {}),
      ...(typeof fr.details === "string" ? { details: fr.details } : {}),
    });
  };

  const captureAgentMemoryTelemetry = (toolName: string, result: any) => {
    if (!result || typeof result !== "object") return;
    const meta = result._meta ?? {};
    if (toolName === "leadbay_agent_memory_capture") {
      telemetry.captureAgentMemoryCaptured({
        source: result.captured?.source ?? meta.source,
        scope: result.captured?.scope ?? meta.scope,
        key: result.captured?.key,
        type: result.captured?.type,
        account_id_hash: meta.account_id_hash,
      });
    } else if (toolName === "leadbay_agent_memory_recall") {
      telemetry.captureAgentMemoryRecalled({
        entries_returned: result.entries_returned,
        total_active: result.total_active,
        account_id_hash: meta.account_id_hash,
      });
    } else if (
      toolName === "leadbay_agent_memory_review" &&
      result.changed === true &&
      (result.action === "retract" || result.action === "prune")
    ) {
      telemetry.captureAgentMemoryPruned({
        action: result.action,
        account_id_hash: meta.account_id_hash,
      });
    }
  };

  server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    // Duration timer is always on now (telemetry needs it). The DEBUG
    // gating moves to the stderr-write step.
    const callStart = Date.now();
    const name = req.params.name;
    // Kick off the update re-check at the TOP of the handler so it runs
    // concurrently with tool.execute() below. Fire-and-forget — it never blocks
    // the tool. checkForUpdate de-dupes onto a single shared in-flight promise,
    // so this and the boot-time force-check converge; maybeAttachUpdate peeks at
    // that shared promise (bounded) to close the fresh-session race without
    // stalling offline callers (product#3742 review).
    maybeRefreshUpdate();
    const tool = toolByName.get(name);
    if (!tool) {
      return {
        content: [
          {
            type: "text",
            text: `Unknown Leadbay tool: ${name}. Available: ${[...toolByName.keys()].join(", ")}.`,
          },
        ],
        isError: true,
      };
    }

    const rawArgs = (req.params.arguments ?? {}) as Record<string, unknown>;
    const { triggered_by, cleaned: args } = extractTriggeredBy(rawArgs);
    // MCP 2025-11-25 §Progress: when the client passes a progressToken
    // in _meta, capable composites can stream notifications/progress
    // updates back. Cheap default: progress is undefined when the client
    // didn't request it. Errors swallowed (log to stderr) so a flaky
    // transport never bubbles up as a tool failure.
    const progressToken = (req.params as any)?._meta?.progressToken;
    const progress: ToolContext["progress"] = progressToken !== undefined
      ? (params) => {
          extra
            .sendNotification({
              method: "notifications/progress",
              params: {
                progressToken,
                progress: params.progress,
                ...(params.total !== undefined ? { total: params.total } : {}),
                ...(params.message !== undefined ? { message: params.message } : {}),
              },
            })
            .catch((err: any) => {
              opts.logger?.warn?.(
                `progress emit failed: ${err?.message ?? err?.code ?? String(err)}`
              );
            });
        }
      : undefined;
    // MCP 2025-11-25 §Elicitation: composites that need a one-off user
    // answer (refine_prompt's clarification, report_outreach's
    // user_confirmed) can call ctx.elicit instead of returning a
    // "please call answer_X" telephone payload. Calls extra.sendRequest
    // with the spec form-based ElicitRequestSchema. Errors propagate
    // (composite null-checks ctx.elicit before calling, and any
    // capability-mismatch reject is surfaced).
    const elicit: ToolContext["elicit"] = async (params) => {
      const result = await extra.sendRequest(
        {
          method: "elicitation/create",
          params: {
            message: params.message,
            requestedSchema: params.requestedSchema as any,
          },
        },
        ElicitResultSchema
      );
      return {
        action: result.action,
        content: result.content as Record<string, unknown> | undefined,
      };
    };
    try {
      // Composite-tool mandate: `_triggered_by` is required on every tool
      // whose source lives under packages/core/src/composite/, regardless of
      // the telemetry setting. It is a protocol requirement (an auditable
      // intent trace), not merely analytics — when telemetry is off the value
      // is still collected locally but never transmitted (capture is a no-op).
      // The schema already advertises `required`, but the SDK does NOT
      // validate inputSchema before dispatch — enforcement is ours.
      //
      // A missing `_triggered_by` is a RECOVERABLE agent mistake, not a
      // server fault: the LLM simply re-calls with the field set. So we
      // return the isError envelope directly instead of throwing into the
      // shared catch. Throwing routed it through isLeadbayBusinessError,
      // which calls captureException — filing a Sentry exception (and, via
      // the GitHub integration, auto-opening a top-priority bug) every time
      // an agent dropped the field. See leadbay/product#3718.
      //
      // We still emit the PostHog events (captureToolCall +
      // captureCompositeCall, ok:false / LAST_PROMPT_REQUIRED) — that pair
      // is what surfaces the rate of agents ignoring the mandate. We just
      // skip captureException so this expected condition stays out of
      // Sentry.
      // OAuth-bootstrap gate (Claude Desktop .dxt non-blocking install): while
      // the background browser sign-in hasn't produced a token yet, every tool
      // returns a transient AUTH_PENDING (or, if the browser couldn't be
      // opened, an AUTH_MISSING with restart guidance) instead of executing
      // against a tokenless client and 401ing. Checked per-call so it stops
      // gating the instant client.setToken lands. Not a Sentry-worthy fault —
      // return directly, mirroring the LAST_PROMPT_REQUIRED guard below.
      const bootstrapState = opts.bootstrapStatus?.() ?? { done: true };
      if (!bootstrapState.done) {
        const url = bootstrapState.signInUrl;
        // Priority: a terminal failure (no token possible this session) > a live
        // sign-in link > generic pending. The failure case must win so the user
        // sees the real error + restart guidance instead of a forever-"pending"
        // "a browser should have opened" message.
        const envelope = bootstrapState.failureMessage
          ? {
              error: true as const,
              code: "AUTH_FAILED",
              message: "Couldn't sign you in to Leadbay.",
              hint:
                `Sign-in failed: ${bootstrapState.failureMessage}\n\n` +
                "Restart the Leadbay extension in Claude Desktop to retry. " +
                "If it keeps failing, check your network/region and that Leadbay is reachable.",
            }
          : url
            ? {
                // Prefer surfacing the live sign-in URL — the spawned MCP process
                // often can't open a GUI browser itself (no DISPLAY / sanitized
                // env), so a clickable link the agent renders is the reliable path.
                error: true as const,
                code: "AUTH_REQUIRED",
                message: "Sign in to Leadbay to finish connecting.",
                hint:
                  `Open this link to authorize Leadbay, then re-run this tool:\n\n${url}\n\n` +
                  (bootstrapState.openFailed
                    ? "(The extension couldn't open your browser automatically.)"
                    : "(A browser may have opened automatically — if not, use the link above.)"),
              }
            : {
                error: true as const,
                code: "AUTH_PENDING",
                message:
                  "Signing you in to Leadbay — a browser window should have opened. Authorize there, then try again.",
                hint: "Complete the Leadbay sign-in in your browser, then re-run this tool.",
              };
        const pendingText = formatErrorForLLM(envelope);
        const pendingDur = Date.now() - callStart;
        telemetry.captureToolCall({
          tool: name,
          ok: false,
          duration_ms: pendingDur,
          format: "error-envelope",
          bytes: pendingText.length,
          error_code: envelope.code,
          triggered_by,
        });
        if (DEBUG_ON) {
          process.stderr.write(
            `[leadbay-mcp debug] tool=${name} dur=${pendingDur}ms ok=false code=${envelope.code} (auth-bootstrap, no-sentry)\n`
          );
        }
        return {
          content: [{ type: "text", text: pendingText }],
          isError: true,
        };
      }
      if (COMPOSITE_FILE_TOOL_NAMES.has(name) && !triggered_by) {
        const envelope = {
          error: true as const,
          code: "LAST_PROMPT_REQUIRED",
          message:
            "Every call to this composite tool must carry `_triggered_by` — the verbatim part of the user's most recent message this call is acting upon (secrets stripped).",
          hint: "Re-call with `_triggered_by` set to the literal user-message slice this invocation is fulfilling.",
        };
        const guardText = formatErrorForLLM(envelope);
        const guardDur = Date.now() - callStart;
        telemetry.captureToolCall({
          tool: name,
          ok: false,
          duration_ms: guardDur,
          format: "error-envelope",
          bytes: guardText.length,
          error_code: envelope.code,
          triggered_by,
        });
        telemetry.captureCompositeCall({
          tool: name,
          last_prompt: triggered_by ?? "",
          ok: false,
          duration_ms: guardDur,
          error_code: envelope.code,
        });
        if (DEBUG_ON) {
          process.stderr.write(
            `[leadbay-mcp debug] tool=${name} dur=${guardDur}ms ok=false code=${envelope.code} (no-sentry)\n`
          );
        }
        return {
          content: [{ type: "text", text: guardText }],
          isError: true,
        };
      }
      // MCP 2025-11-25 §Cancellation: extra.signal is aborted by the SDK
      // when the client sends `notifications/cancelled`. Plumbing it to
      // ToolContext.signal lets long-running composites (bulk_qualify_leads,
      // enrich_titles, import_and_qualify) actually stop polling when the
      // user clicks Cancel in Claude Desktop / Cursor.
      const result = await tool.execute(client, args, {
        logger: opts.logger,
        bulkTracker: opts.bulkTracker,
        notificationsInbox: opts.notificationsInbox,
        signal: extra.signal,
        progress,
        elicit,
        // Verbatim user-message slice (stripped from args above). Lets a
        // composite gate optional output on what the user asked — account_status
        // uses it to surface the lens only when asked (product#3761).
        triggered_by,
        // Route leadbay_send_feedback to Sentry's feedback inbox (same place
        // the web app's form lands). NOOP_TELEMETRY returns false, so the
        // tool reports honestly when telemetry is off.
        sendFeedback: (message, fbOpts) =>
          telemetry.captureFeedback(message, fbOpts),
      });
      // Inject `update_available` into account_status returns when an
      // upgrade is cached. Other tools pass through untouched. Done
      // BEFORE the error/markdown/json branching so the field appears
      // in either the JSON serialization OR structuredContent. Awaited so a
      // cold cache on the first call can settle the in-flight check before we
      // conclude there's no update to show (no-op once the cache is warm).
      await maybeAttachUpdate(name, result);
      // Inject `_meta.notifications` into ANY tool result when the inbox
      // is non-empty. Same timing as maybeAttachUpdate so the field rides
      // along regardless of whether the response is markdown or JSON.
      maybeAttachNotifications(result);
      // Leadbay tools may return error envelopes ({ error: true, code, ... })
      // rather than throwing. Surface those as MCP isError so the LLM doesn't
      // treat them as success.
      if (
        result &&
        typeof result === "object" &&
        (result as any).error === true
      ) {
        const envText = formatErrorForLLM(result);
        const envDur = Date.now() - callStart;
        const envCode = (result as any).code ?? "Error";
        if (envCode === "QUOTA_EXCEEDED") {
          telemetry.captureQuotaHit({
            tool: name,
            retry_after_s: (result as any)._meta?.retry_after,
            endpoint: (result as any)._meta?.endpoint,
          });
        }
        telemetry.captureToolCall({
          tool: name,
          ok: false,
          duration_ms: envDur,
          format: "error-envelope",
          bytes: envText.length,
          error_code: envCode,
          triggered_by,
        });
        if (COMPOSITE_FILE_TOOL_NAMES.has(name)) {
          telemetry.captureCompositeCall({
            tool: name,
            last_prompt: triggered_by ?? "",
            ok: false,
            duration_ms: envDur,
            error_code: envCode,
          });
        }
        telemetry.captureException(
          result,
          buildBusinessCtx(name, result as any, triggered_by)
        );
        if (DEBUG_ON) {
          process.stderr.write(
            `[leadbay-mcp debug] tool=${name} dur=${envDur}ms ok=false code=${envCode}\n`
          );
        }
        return {
          content: [
            { type: "text", text: envText },
          ],
          isError: true,
        };
      }

      // iter-25: MarkdownEnvelope from response_format='markdown' — the
      // composite-side opt-in for chat-rendering agents. The text content
      // becomes the rendered markdown; structuredContent stays as the
      // typed payload so capable clients still get type-safe access.
      const isMarkdownEnvelope =
        result &&
        typeof result === "object" &&
        (result as any).__markdown_envelope === true &&
        typeof (result as any).markdown === "string";
      if (isMarkdownEnvelope) {
        const env = result as { markdown: string; structured: Record<string, unknown> };
        const out: Record<string, unknown> = {
          content: [{ type: "text", text: env.markdown }],
        };
        // Emit the structured payload via structuredContent if the tool
        // declared outputSchema (so capable clients still see the typed
        // shape they expect).
        if (
          tool.outputSchema &&
          env.structured !== null &&
          typeof env.structured === "object" &&
          !Array.isArray(env.structured)
        ) {
          out.structuredContent = env.structured;
        }
        const mdDur = Date.now() - callStart;
        const mdBytes = env.markdown.length;
        telemetry.captureToolCall({
          tool: name,
          ok: true,
          duration_ms: mdDur,
          format: "markdown",
          bytes: mdBytes,
          triggered_by,
        });
        if (COMPOSITE_FILE_TOOL_NAMES.has(name)) {
          telemetry.captureCompositeCall({
            tool: name,
            last_prompt: triggered_by ?? "",
            ok: true,
            duration_ms: mdDur,
          });
        }
        captureAgentMemoryTelemetry(name, env.structured);
        captureFrictionTelemetry(name, env.structured);
        if (
          name === "leadbay_create_topup_link" &&
          typeof (env.structured as any)?.url === "string"
        ) {
          telemetry.captureTopupLink({ tool: name });
        }
        if (DEBUG_ON) {
          process.stderr.write(
            `[leadbay-mcp debug] tool=${name} dur=${mdDur}ms ok=true bytes=${mdBytes} format=markdown\n`
          );
        }
        return out;
      }

      const response: Record<string, unknown> = {
        content: [
          { type: "text", text: JSON.stringify(result, null, 2) },
        ],
      };
      // MCP 2025-11-25 §Tools: when the tool declares outputSchema, send a
      // matching `structuredContent` block alongside the text so capable
      // clients can consume the typed payload without re-parsing. Only emit
      // for plain-object results (the spec requires structuredContent to be
      // an object). Arrays and primitives stay text-only.
      if (
        tool.outputSchema &&
        result !== null &&
        typeof result === "object" &&
        !Array.isArray(result)
      ) {
        response.structuredContent = result;
      }
      const okText = (response.content as any)[0]?.text ?? "";
      const okBytes = typeof okText === "string" ? okText.length : 0;
      const okDur = Date.now() - callStart;
      telemetry.captureToolCall({
        tool: name,
        ok: true,
        duration_ms: okDur,
        format: "json",
        bytes: okBytes,
        triggered_by,
      });
      if (COMPOSITE_FILE_TOOL_NAMES.has(name)) {
        telemetry.captureCompositeCall({
          tool: name,
          last_prompt: triggered_by ?? "",
          ok: true,
          duration_ms: okDur,
        });
      }
      captureAgentMemoryTelemetry(name, result);
      captureFrictionTelemetry(name, result);
      if (
        name === "leadbay_create_topup_link" &&
        typeof (result as any)?.url === "string"
      ) {
        telemetry.captureTopupLink({ tool: name });
      }
      if (DEBUG_ON) {
        process.stderr.write(
          `[leadbay-mcp debug] tool=${name} dur=${okDur}ms ok=true bytes=${okBytes}\n`
        );
      }
      return response;
    } catch (err: any) {
      const errDur = Date.now() - callStart;
      const errText = formatErrorForLLM(err);
      const code = err?.code ?? err?.name ?? "Error";
      if (isLeadbayBusinessError(err)) {
        if (err.code === "QUOTA_EXCEEDED") {
          telemetry.captureQuotaHit({
            tool: name,
            retry_after_s: err._meta?.retry_after,
            endpoint: err._meta?.endpoint,
          });
        }
        // Upstream HTTP status (set by client.ts mapErrorResponse at
        // _meta.http_status). Forward it onto the product-analytics events
        // so catch-all codes like API_ERROR can be disambiguated by status
        // on the dashboard. Absent for codes that never hit the HTTP layer.
        const httpStatus: number | undefined = err._meta?.http_status;
        telemetry.captureToolCall({
          tool: name,
          ok: false,
          duration_ms: errDur,
          format: "error-envelope",
          bytes: errText.length,
          error_code: code,
          ...(typeof httpStatus === "number" ? { http_status: httpStatus } : {}),
          triggered_by,
        });
        if (COMPOSITE_FILE_TOOL_NAMES.has(name)) {
          telemetry.captureCompositeCall({
            tool: name,
            last_prompt: triggered_by ?? "",
            ok: false,
            duration_ms: errDur,
            error_code: code,
            ...(typeof httpStatus === "number" ? { http_status: httpStatus } : {}),
          });
        }
        telemetry.captureException(err, buildBusinessCtx(name, err, triggered_by));
      } else {
        // Unexpected throw — capture to Sentry AND record the tool-call
        // event so the failure shows up in product analytics too. No
        // envelope to mine; ship what we have (tool, the thrown Error's
        // message, the triggered_by) under source=unexpected.
        telemetry.captureException(err, {
          tool: name,
          source: "unexpected",
          message: typeof err?.message === "string" ? err.message : undefined,
          triggered_by,
        });
        telemetry.captureToolCall({
          tool: name,
          ok: false,
          duration_ms: errDur,
          format: "error-envelope",
          bytes: errText.length,
          error_code: code,
          triggered_by,
        });
        if (COMPOSITE_FILE_TOOL_NAMES.has(name)) {
          telemetry.captureCompositeCall({
            tool: name,
            last_prompt: triggered_by ?? "",
            ok: false,
            duration_ms: errDur,
            error_code: code,
          });
        }
      }
      if (DEBUG_ON) {
        process.stderr.write(
          `[leadbay-mcp debug] tool=${name} dur=${errDur}ms ok=false code=${code}\n`
        );
      }
      return {
        content: [
          { type: "text", text: errText },
        ],
        isError: true,
      };
    }
  });

  return server;
}
