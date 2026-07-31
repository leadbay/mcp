import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext } from "../types.js";

import { leadbay_report_friction as REPORT_FRICTION_DESCRIPTION } from "../tool-descriptions.generated.js";
import { COMPOSITE_FILE_TOOL_NAMES } from "./_composite-file-names.js";

// Friction reporting lets a user tell the Leadbay team that a specific tool
// result let them down — an empty lead list where hits were expected, a wrong
// region, a capability that doesn't exist yet. The backend only sees explicit
// errors (4xx, 5xx, business-error envelopes), never "that search came back
// empty again".
//
// CONSENT: this tool is user-initiated and user-visible. The agent either acts
// on an explicit request ("report this to the team") or offers once and gets a
// yes; the `message` is the user's own words, confirmed before sending, and the
// result carries a confirmation string the agent shows back. It must never fire
// unprompted or silently — that framing was removed deliberately (product#3943).
//
// Wire shape: emits a dedicated `mcp friction reported` PostHog event via
// the existing MCP-side telemetry hook (see captureFrictionTelemetry in
// packages/mcp/src/server.ts — pattern parallel to captureAgentMemoryTelemetry).
// Only fields the user approved travel with it. No Leadbay backend POST today —
// a backend endpoint can dual-write later.

export type FrictionCategory =
  | "silent_failure"
  | "repeated_request"
  | "wrong_result"
  | "dissatisfaction"
  | "missing_capability"
  | "other";

export interface ReportFrictionParams {
  category: FrictionCategory;
  message: string;
  tool_called?: string;
  severity?: "low" | "medium" | "high";
}

const VALID_CATEGORIES = new Set<FrictionCategory>([
  "silent_failure",
  "repeated_request",
  "wrong_result",
  "dissatisfaction",
  "missing_capability",
  "other",
]);

const VALID_SEVERITIES = new Set(["low", "medium", "high"]);

// `tool_called` is agent-authored and rides along to analytics, but the user
// only ever approves `message`. The MCP SDK does not validate inputSchema before
// dispatch (enforcement is ours — see server.ts), so an unchecked string here
// would be a second unapproved free-text channel — exactly what deleting
// `details` was meant to close (product#3943).
//
// Shape-matching alone is NOT enough: `leadbay_card_4111111111111111` satisfies
// any `leadbay_[a-z0-9_]+` pattern, so a malformed agent could still smuggle
// secrets/PII encoded as a fake tool name. Allowlist against the real composite
// registry instead — it is a dependency-free leaf module (no circular import
// back through index.ts) and is already audited for drift.
const KNOWN_TOOL_NAMES: ReadonlySet<string> = COMPOSITE_FILE_TOOL_NAMES;

// Report-message cap. Identical bound to the `_triggered_by` meta-param in
// packages/mcp/src/server.ts — PostHog property strings balloon quickly, and a
// report longer than this is almost certainly the agent padding the user's words.
const MESSAGE_MAX = 500;

export const reportFriction: Tool<ReportFrictionParams> = {
  name: "leadbay_report_friction",
  annotations: {
    title: "Report a problem to the Leadbay team",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  description: REPORT_FRICTION_DESCRIPTION,
  optional: true,
  // Not write:true — friction reporting does NOT mutate Leadbay state and
  // must remain callable even when LEADBAY_MCP_WRITE=0. Registered in
  // compositeReadTools (always-on) so a user on a read-only deployment can
  // still ask for a problem to be reported.
  write: false,
  inputSchema: {
    type: "object",
    properties: {
      category: {
        type: "string",
        enum: [
          "silent_failure",
          "repeated_request",
          "wrong_result",
          "dissatisfaction",
          "missing_capability",
          "other",
        ],
        description:
          "Bucket: silent_failure (tool returned ok but produced no useful output — empty list, wrong region, etc.), repeated_request (user had to ask for the same thing 2+ times because earlier turns didn't deliver), wrong_result (tool returned data but it answered a different question than the user asked), dissatisfaction (user is unhappy with a result and wants the team to know), missing_capability (user wants something the MCP can't do — 'why can't I…', 'I wish you could…'), other.",
      },
      message: {
        type: "string",
        description:
          "What the user wants to report, in their own words (cap 500 chars). Required. If the user already stated the problem when asking you to report it, those words ARE the message — send them in the same turn; do NOT ask them to re-confirm wording they just gave you. Only go back to them when you would otherwise have to invent the wording. Never call this tool unprompted.",
      },
      tool_called: {
        type: "string",
        pattern: "^leadbay_[a-z0-9_]{1,60}$",
        description:
          "Optional: the bare name of the registered Leadbay tool that disappointed, e.g. 'leadbay_pull_leads'. This is NOT a free-text field — any value that is not an actual registered tool name is dropped, so never encode context, detail, or user data here. Put context in the user-approved `message` instead.",
      },
      severity: {
        type: "string",
        enum: ["low", "medium", "high"],
        description:
          "Optional: low (minor papercut, user moved on), medium (user noticeably frustrated or had to repeat), high (user gave up / explicitly said this is broken).",
      },
    },
    required: ["category", "message"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    description:
      "Confirmation the report was sent. `reported: true` + a user-facing `message` the agent should show back to the user. The `_friction` block carries the analytics payload — the MCP server detects it and emits a `mcp friction reported` PostHog event containing only the fields the user approved.",
    properties: {
      reported: { type: "boolean" },
      message: { type: "string" },
      _friction: {
        type: "object",
        properties: {
          category: { type: "string" },
          message: { type: "string" },
          tool_called: { type: "string" },
          severity: { type: "string" },
        },
      },
      _meta: {
        type: "object",
        properties: { region: { type: "string" } },
      },
    },
  },
  execute: async (
    client: LeadbayClient,
    params: ReportFrictionParams,
    ctx?: ToolContext
  ) => {
    if (!params.category || !VALID_CATEGORIES.has(params.category)) {
      return {
        error: true,
        code: "BAD_INPUT",
        message: `category must be one of: ${[...VALID_CATEGORIES].join(", ")} (got: ${params.category})`,
        hint:
          "Set `category` to one of: silent_failure (tool returned ok but produced no useful output), repeated_request (user asked 2+ times), wrong_result (tool answered a different question), dissatisfaction (user expressed unhappiness), missing_capability (MCP can't do it), other.",
      };
    }
    if (typeof params.message !== "string" || params.message.trim().length === 0) {
      return {
        error: true,
        code: "BAD_INPUT",
        message: "message is required — pass what the user wants to report, in their own words.",
        hint: "Ask the user what they want reported and confirm the wording, then pass it as `message`. Do not call this tool unprompted.",
      };
    }
    if (params.severity && !VALID_SEVERITIES.has(params.severity)) {
      return {
        error: true,
        code: "BAD_INPUT",
        message: `severity must be one of: low, medium, high (got: ${params.severity})`,
        hint: "Set `severity` to low | medium | high, or drop the field entirely.",
      };
    }

    const message =
      params.message.length > MESSAGE_MAX
        ? `${params.message.slice(0, MESSAGE_MAX)}…`
        : params.message;

    // Drop a malformed tool_called rather than rejecting the call: the user's
    // approved message is the payload that matters, and failing their report
    // over an agent-side slip would be worse than reporting without the hint.
    const toolCalled =
      typeof params.tool_called === "string" &&
      KNOWN_TOOL_NAMES.has(params.tool_called)
        ? params.tool_called
        : undefined;

    const report = {
      category: params.category,
      message,
      ...(toolCalled ? { tool_called: toolCalled } : {}),
      ...(params.severity ? { severity: params.severity } : {}),
    };

    // The transport is wired by the MCP server. If it's absent or the handle is
    // NOOP (telemetry disabled, no keys, tests) the report was NOT delivered.
    // Because this tool is user-visible and the agent reads `message` back to
    // the user, claiming success here would be a false confirmation for a report
    // that never left the machine — same honesty contract as
    // leadbay_send_feedback (product#3943).
    const delivered = ctx?.reportFriction ? ctx.reportFriction(report) : false;

    if (!delivered) {
      return {
        reported: false,
        message:
          "This report could NOT be sent from this client (problem reporting isn't available here — telemetry is off or unavailable). Tell the user it was not delivered; do not claim it was shared.",
        _friction: report,
        _meta: { region: client.region },
      };
    }

    return {
      reported: true,
      // User-facing confirmation. This tool is consent-gated and visible: the
      // agent shows this line back so the user always knows the report was
      // sent and is never surprised by it.
      message: "Shared with the Leadbay team — thanks for flagging it.",
      _friction: report,
      _meta: { region: client.region },
    };
  },
};
