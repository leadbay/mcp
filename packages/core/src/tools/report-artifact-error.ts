import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext } from "../types.js";

import { leadbay_report_artifact_error as ARTIFACT_EVENT_DESCRIPTION } from "../tool-descriptions.generated.js";

// leadbay_report_artifact_error is the ingest endpoint for the @leadbay/components
// artifact runtime (product#4081). An artifact runs in a chat-hosted page whose
// ONLY channel out is window.cowork.callMcpTool, so a runtime failure can only
// reach us as a tool call — this is that call.
//
// It makes no backend call and mutates nothing. Its entire job is to hand the
// event to the MCP telemetry layer via ctx.reportArtifactEvent, which routes it
// the way the rest of this repo already splits telemetry:
//   exceptions (bridge_unavailable / call_timeout / call_failed / parse_failed)
//     → Sentry, source:"artifact"
//   outcomes  (options_empty / action_blocked / result_rejected)
//     → PostHog, `mcp artifact event`
//
// It is deliberately NOT leadbay_report_friction: that tool is consent-gated,
// carries the user's own words, and must never fire unprompted. This one is
// automatic diagnostics and carries only bounded enums + error CODES — never a
// message, never user text (the product#3943 line).
//
// The leadbay_set_telemetry opt-out needs no special handling here: the call
// goes through normal dispatch, so the hosted suppressTelemetry predicate
// already NOOPs the capture for an opted-out user, exactly as it does for
// `mcp tool called`.
//
// Lives in tools/ (granular-shaped: static relay, no orchestration) so it stays
// OUT of COMPOSITE_FILE_TOOL_NAMES and carries no `_triggered_by` mandate — an
// artifact button click has no fresh user utterance to quote. Registered in
// compositeReadTools so it is always exposed, alongside leadbay_get_artifact_runtime.

/** Exception kinds — routed to Sentry. Something threw. */
const EXCEPTION_KINDS = [
  "bridge_unavailable",
  "call_timeout",
  "call_failed",
  "parse_failed",
] as const;

/** Outcome kinds — routed to PostHog. Nothing threw; the UI is just wrong. */
const OUTCOME_KINDS = ["options_empty", "action_blocked", "result_rejected"] as const;

export const ARTIFACT_EVENT_KINDS = [...EXCEPTION_KINDS, ...OUTCOME_KINDS] as const;

export const ARTIFACT_EVENT_SURFACES = [
  "call",
  "field",
  "action",
  "resource",
  "list",
] as const;

export type ArtifactEventKind = (typeof ARTIFACT_EVENT_KINDS)[number];
export type ArtifactEventSurface = (typeof ARTIFACT_EVENT_SURFACES)[number];

export interface ArtifactEventParams {
  kind?: string;
  surface?: string;
  kit_version?: string;
  tool?: string;
  code?: string;
}

const KINDS = new Set<string>(ARTIFACT_EVENT_KINDS);
const SURFACES = new Set<string>(ARTIFACT_EVENT_SURFACES);

// Bound every free-ish string before it becomes a Sentry tag / PostHog property.
// `tool` and `code` come from the artifact page, which the agent authored — so
// they are not attacker-controlled, but they ARE unvalidated, and an unbounded
// property is how a telemetry backend gets poisoned. Codes are short by nature;
// anything longer is a bug or a message that leaked into the wrong field.
const MAX_FIELD = 120;

function bounded(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (!t) return undefined;
  return t.length > MAX_FIELD ? t.slice(0, MAX_FIELD) : t;
}

export const artifactEvent: Tool<ArtifactEventParams> = {
  name: "leadbay_report_artifact_error",
  annotations: {
    title: "Report an artifact runtime failure",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  description: ARTIFACT_EVENT_DESCRIPTION,
  write: false,
  inputSchema: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: [...ARTIFACT_EVENT_KINDS],
        description:
          "What went wrong. Exceptions: bridge_unavailable, call_timeout, call_failed, parse_failed. Outcomes (nothing threw): options_empty, action_blocked, result_rejected.",
      },
      surface: {
        type: "string",
        enum: [...ARTIFACT_EVENT_SURFACES],
        description:
          "Which view-model surfaced it: call, field, action, resource, or list.",
      },
      kit_version: {
        type: "string",
        description: "The @leadbay/components runtime version that emitted this.",
      },
      tool: {
        type: "string",
        description: "The Leadbay tool involved, when attributable to one.",
      },
      code: {
        type: "string",
        description:
          "Bounded error code (e.g. timeout, unavailable, QUOTA_EXCEEDED). NEVER a message — messages can carry user or API text.",
      },
    },
    required: ["kind", "surface"],
    additionalProperties: false,
  },
  // No outputSchema: the return is a two-key acknowledgement, and declaring one
  // would enroll this tool in the output-schema-conformance drift-catcher for
  // no benefit.
  execute: async (
    _client: LeadbayClient,
    params: ArtifactEventParams,
    ctx?: ToolContext,
  ) => {
    const kind = typeof params.kind === "string" ? params.kind : "";
    const surface = typeof params.surface === "string" ? params.surface : "";

    // Validate the enums explicitly: the MCP SDK does NOT enforce inputSchema
    // enums before dispatch (same reasoning as leadbay_set_telemetry's
    // BAD_ACTION guard), and an unknown kind would otherwise become an
    // unbounded Sentry tag / PostHog property value.
    if (!KINDS.has(kind) || !SURFACES.has(surface)) {
      return {
        error: true,
        code: "BAD_INPUT",
        message: `Unknown artifact event (kind="${kind}", surface="${surface}").`,
        hint:
          "Do not call leadbay_report_artifact_error yourself — the artifact runtime " +
          "from leadbay_get_artifact_runtime calls it automatically. To report a " +
          "problem the user raised, call leadbay_report_friction instead. If " +
          "you are that runtime, re-call with kind set to one of " +
          `${ARTIFACT_EVENT_KINDS.join(", ")} and surface set to one of ` +
          `${ARTIFACT_EVENT_SURFACES.join(", ")}.`,
      };
    }

    // Fire-and-forget. `reportArtifactEvent` is absent under a bare
    // ToolContext (tests, non-MCP embedders); recording is best-effort by
    // design and an artifact has no user to report a telemetry failure to.
    ctx?.reportArtifactEvent?.({
      kind,
      surface,
      ...(bounded(params.kit_version) ? { kit_version: bounded(params.kit_version)! } : {}),
      ...(bounded(params.tool) ? { tool: bounded(params.tool)! } : {}),
      ...(bounded(params.code) ? { code: bounded(params.code)! } : {}),
    });

    // `recorded` reflects only that the event was ACCEPTED and handed to the
    // telemetry layer — never that it was delivered. Delivery depends on the
    // user's opt-out and the sink's availability, and unlike
    // leadbay_report_friction there is no user waiting on a confirmation, so
    // there is nothing to be honest to. The artifact ignores this result.
    return { recorded: true, kind };
  },
};
