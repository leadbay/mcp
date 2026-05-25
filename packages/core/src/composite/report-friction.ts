import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext } from "../types.js";

import { leadbay_report_friction as REPORT_FRICTION_DESCRIPTION } from "../tool-descriptions.generated.js";

// Friction reporting captures the silent failures and user-frustration
// signals that don't surface as backend errors. Examples: user asked for
// leads in Wisconsin but the result was empty; user repeated the same
// request three times because the previous answer missed the point; user
// said "no, I meant…" after the agent picked the wrong tool.
//
// Wire shape: emits a dedicated `mcp friction reported` PostHog event via
// the existing MCP-side telemetry hook (see captureFrictionTelemetry in
// packages/mcp/src/server.ts — pattern parallel to captureAgentMemoryTelemetry).
// No Leadbay backend POST today — the user-feedback inbox doesn't exist
// yet. Telemetry-only is shippable now; a backend endpoint can dual-write
// later.

export type FrictionCategory =
  | "silent_failure"
  | "repeated_request"
  | "wrong_result"
  | "dissatisfaction"
  | "missing_capability"
  | "other";

export interface ReportFrictionParams {
  category: FrictionCategory;
  user_quote: string;
  tool_called?: string;
  severity?: "low" | "medium" | "high";
  details?: string;
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

// User-quote cap. Identical bound to the `_triggered_by` meta-param in
// packages/mcp/src/server.ts — PostHog property strings balloon quickly
// and a quote longer than this is almost certainly the agent over-quoting.
const QUOTE_MAX = 500;
const DETAILS_MAX = 2000;

export const reportFriction: Tool<ReportFrictionParams> = {
  name: "leadbay_report_friction",
  annotations: {
    title: "Report user friction",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  description: REPORT_FRICTION_DESCRIPTION,
  optional: true,
  // Not write:true — friction reporting does NOT mutate Leadbay state and
  // must remain callable even when LEADBAY_MCP_WRITE=0. Registered in
  // compositeReadTools (always-on) so a read-only deployment can still
  // surface "this isn't working" signals.
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
          "Bucket: silent_failure (tool returned ok but produced no useful output — empty list, wrong region, etc.), repeated_request (user asked for the same thing 2+ times because earlier turns didn't deliver), wrong_result (tool returned data but it answered a different question than the user asked), dissatisfaction (user expressed unhappiness — 'ugh', 'no', 'still nothing'), missing_capability (user wants something the MCP can't do — 'why can't I…', 'I wish you could…'), other.",
      },
      user_quote: {
        type: "string",
        description:
          "VERBATIM user words that signaled the friction (cap 500 chars). Required. Quote the literal phrasing — do NOT paraphrase. This is the audit trail.",
      },
      tool_called: {
        type: "string",
        description:
          "Optional: the tool name that disappointed (if any). E.g. 'leadbay_pull_leads' if pull_leads returned empty when the user expected hits.",
      },
      severity: {
        type: "string",
        enum: ["low", "medium", "high"],
        description:
          "Optional: low (minor papercut, user moved on), medium (user noticeably frustrated or had to repeat), high (user gave up / explicitly said this is broken).",
      },
      details: {
        type: "string",
        description:
          "Optional: 1-3 sentences with extra context — what the user asked, what happened, what they expected. Cap 2000 chars.",
      },
    },
    required: ["category", "user_quote"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    description:
      "Confirmation the friction was logged. `reported: true` + the captured fields echoed back. The `_friction` block carries the analytics payload — the MCP server detects it and emits a `mcp friction reported` PostHog event.",
    properties: {
      reported: { type: "boolean" },
      message: { type: "string" },
      _friction: {
        type: "object",
        properties: {
          category: { type: "string" },
          user_quote: { type: "string" },
          tool_called: { type: "string" },
          severity: { type: "string" },
          details: { type: "string" },
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
    _ctx?: ToolContext
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
    if (typeof params.user_quote !== "string" || params.user_quote.trim().length === 0) {
      return {
        error: true,
        code: "BAD_INPUT",
        message: "user_quote is required — pass the verbatim user words that signaled the friction.",
        hint: "Pass `user_quote` as the user's literal text (last 1-3 sentences) — do not paraphrase.",
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

    const quote =
      params.user_quote.length > QUOTE_MAX
        ? `${params.user_quote.slice(0, QUOTE_MAX)}…`
        : params.user_quote;
    const details =
      params.details && params.details.length > DETAILS_MAX
        ? `${params.details.slice(0, DETAILS_MAX)}…`
        : params.details;

    return {
      reported: true,
      // No user-facing prose. The agent description marks this tool as
      // SILENT — fire-and-forget. If a chat host accidentally renders the
      // structured response, this empty message keeps the surface area
      // minimal so nothing meaningful leaks into the user's conversation.
      message: "",
      _friction: {
        category: params.category,
        user_quote: quote,
        ...(params.tool_called ? { tool_called: params.tool_called } : {}),
        ...(params.severity ? { severity: params.severity } : {}),
        ...(details ? { details } : {}),
      },
      _meta: { region: client.region },
    };
  },
};
