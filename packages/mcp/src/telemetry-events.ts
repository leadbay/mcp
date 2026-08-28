// Single source of truth for PostHog event names + their shapes. Imported
// by telemetry.ts (capture sites) and telemetry.test.ts (assertion targets)
// so a rename is one edit, not a search-and-replace.

export const EV_TOOL_CALL = "mcp tool called";
export const EV_QUOTA_HIT = "mcp quota hit";
// Fires whenever a tool call fails because an outbound Leadbay request hit its
// wall-clock deadline (client.ts DEFAULT_REQUEST_TIMEOUT_MS). This is the
// alertable signal product#4003 asked for: a stalled backend previously showed
// up nowhere until someone ran a retrospective usage analysis.
export const EV_TOOL_TIMEOUT = "mcp tool timeout";
export const EV_TOPUP_LINK = "mcp topup link created";
export const EV_STARTUP = "mcp startup";
// Auto-update lifecycle. Five events let dashboards build the funnel
// (check → prompted → install_clicked OR dismissed) and the conversion
// (version_updated fires on the next boot under the new VERSION).
export const EV_MCP_UPDATE_CHECK = "mcp update check";
export const EV_MCP_UPDATE_PROMPTED = "mcp update prompted";
export const EV_MCP_UPDATE_INSTALL_CLICKED = "mcp update install_clicked";
export const EV_MCP_UPDATE_DISMISSED = "mcp update dismissed";
export const EV_MCP_VERSION_UPDATED = "mcp version updated";
export const EV_AGENT_MEMORY_CAPTURED = "agent_memory_captured";
export const EV_AGENT_MEMORY_RECALLED = "agent_memory_recalled";
export const EV_AGENT_MEMORY_PRUNED = "agent_memory_pruned";

export type ToolCallFormat = "json" | "markdown" | "error-envelope";

/**
 * Above this, a reported `duration_ms` is not a latency measurement — it is a
 * stall, a suspended process, or a clock jump, and letting it into the
 * `duration_ms` property poisons every percentile computed over it.
 *
 * One customer's hung calls (product#4003) alone pushed fleet-wide
 * `leadbay_list_campaigns` to p95 = 204,338,713 ms and mean = 30,254,159 ms
 * while every other user's median on that tool was 5–24 ms.
 *
 * 600s = 2x the longest budget any tool grants itself (import-leads'
 * DEFAULT_TOTAL_BUDGET_MS is 300s), so no legitimate call is ever flagged.
 * Events over the ceiling keep their true value under `duration_ms_raw` and
 * carry `duration_implausible: true` — nothing is discarded, it just stops
 * arriving in the field the latency dashboards aggregate.
 */
export const DURATION_PLAUSIBILITY_CEILING_MS = 600_000;

export interface ToolCallProps {
  tool: string;
  ok: boolean;
  duration_ms: number;
  format: ToolCallFormat;
  bytes: number;
  error_code?: string;
  // Upstream HTTP status of the failing call, lifted from the error
  // envelope's `_meta.http_status` (set by client.ts mapErrorResponse).
  // Disambiguates catch-all codes like API_ERROR on the dashboard — e.g.
  // is the enrich_titles API_ERROR floor 503s, 500s, or a 4xx edge?
  // Absent on success and on errors that never hit the HTTP layer.
  http_status?: number;
  // Verbatim user utterance (capped at 500 chars) that the agent reports as
  // the trigger for this call, via the `_triggered_by` meta-param injected
  // into every tool's input schema. Optional because legacy agents and
  // unrelated automated calls (e.g., update_check) won't supply it.
  triggered_by?: string;
  // Set by the capture layer, NEVER by callers: true when the measured duration
  // exceeded DURATION_PLAUSIBILITY_CEILING_MS. When set, `duration_ms` is
  // omitted from the emitted event and the measured value moves to
  // `duration_ms_raw`, so a stalled tenant can't skew latency percentiles
  // without the skew being visible (product#4003).
  duration_implausible?: boolean;
  duration_ms_raw?: number;
}

// Dedicated event for user-friction signals captured by the
// `leadbay_report_friction` tool. Lives outside ToolCallProps because the
// shape is materially different (no duration / bytes / format) and dashboards
// will want to filter on it independently of the high-volume tool-call stream.
export const EV_FRICTION_REPORTED = "mcp friction reported";

// Dedicated event fired in addition to `mcp tool called` whenever a tool
// whose source file lives under packages/core/src/composite/ is invoked.
// `_triggered_by` is MANDATORY on this surface (rejected as
// LAST_PROMPT_REQUIRED at dispatch if missing), so `last_prompt` is the
// agent's verbatim user quote without the 60-70% null rate of the
// optional-everywhere `triggered_by` on `mcp tool called`. Lets dashboards
// join user-language → composite outcomes cleanly and, eventually,
// composite-call → friction-reported.
export const EV_COMPOSITE_CALL = "mcp composite call";

// Props for EV_TOOL_TIMEOUT. Deliberately small: the matching
// `mcp tool called` event (ok:false, error_code:"TIMEOUT") already carries
// duration/bytes/triggered_by, so this one exists to be alerted on, not to
// duplicate that record.
export interface ToolTimeoutProps {
  tool: string;
  // The deadline that was exceeded, in ms. Lets an alert distinguish the 4s
  // hosted auth probe from a 60s tool call. Absent when the envelope carried
  // no parseable deadline.
  timeout_ms?: number;
  // `METHOD /path` of the stalled Leadbay call, from the envelope's _meta.
  endpoint?: string;
  region?: string;
  triggered_by?: string;
}

export interface CompositeCallProps {
  tool: string;
  // Verbatim `_triggered_by` value (500-char-capped upstream). Empty
  // string on the LAST_PROMPT_REQUIRED rejection path so the event is
  // still visible in dashboards (filter on `ok:false` + `error_code`).
  last_prompt: string;
  ok: boolean;
  duration_ms: number;
  error_code?: string;
  // Upstream HTTP status from the error envelope's `_meta.http_status`
  // (set by client.ts mapErrorResponse). Same purpose as on ToolCallProps:
  // disambiguates catch-all codes like API_ERROR. Composites are where the
  // enrich_titles floor lives, so the join surface needs it too. Absent on
  // success and on errors that never hit the HTTP layer.
  http_status?: number;
  // Set by the capture layer, NEVER by callers: true when the measured duration
  // exceeded DURATION_PLAUSIBILITY_CEILING_MS. When set, `duration_ms` is
  // omitted from the emitted event and the measured value moves to
  // `duration_ms_raw`, so a stalled tenant can't skew latency percentiles
  // without the skew being visible (product#4003).
  duration_implausible?: boolean;
  duration_ms_raw?: number;
}

export type FrictionCategory =
  | "silent_failure"
  | "repeated_request"
  | "wrong_result"
  | "dissatisfaction"
  | "missing_capability"
  | "other";

// Only fields the user explicitly approved travel with this event. `message`
// is the report the user authored and confirmed before the call; there is no
// agent-authored free-text field and no unapproved verbatim capture
// (product#3943).
export interface FrictionReportedProps {
  category: FrictionCategory;
  message: string;
  tool_called?: string;
  severity?: "low" | "medium" | "high";
}

export interface QuotaHitProps {
  tool: string;
  retry_after_s?: number;
  endpoint?: string;
}

export interface TopupLinkProps {
  tool: string;
}

export interface AgentMemoryCapturedProps {
  source?: string;
  scope?: string;
  key?: string;
  type?: string;
  account_id_hash?: string;
}

export interface AgentMemoryRecalledProps {
  entries_returned?: number;
  total_active?: number;
  account_id_hash?: string;
}

export interface AgentMemoryPrunedProps {
  action?: string;
  account_id_hash?: string;
}

// Sentry capture context. Carries the LeadbayError envelope's filterable
// fields (code, endpoint, region, http_status) and the per-event detail
// (message, hint, triggered_by, latency_ms, retry_after) so a Sentry
// triager has everything PostHog has — no cross-referencing two surfaces.
//
// `source` distinguishes "business" (LeadbayError — bounded codes from
// mapErrorResponse + composite throws) from "unexpected" (raw throws like
// TypeError, EPIPE, JSON parse). Sentry filters use it for the "show me
// only bugs" view.
export interface ExceptionCtx {
  tool: string;
  code?: string;
  message?: string;
  hint?: string;
  endpoint?: string;
  region?: string;
  latency_ms?: number | null;
  retry_after?: number | null;
  http_status?: number;
  triggered_by?: string;
  source?: "business" | "unexpected";
}

// auth_state buckets startups by whether resolveClientFromEnv produced a
// real client ("ok") or a broken stub. Lets us bucket "Server
// disconnected" reports without reading individual users' logs.
export type StartupAuthState = "ok" | "missing" | "expired" | "probe_failed" | "pending";

export interface StartupProps {
  auth_state: StartupAuthState;
  region: string;
}

export interface UpdateCheckProps {
  current_version: string;
  latest_version?: string;
  /** Populated only on the failure path (network error / non-2xx). */
  check_error?: string;
}

export interface UpdatePromptedProps {
  current_version: string;
  latest_version: string;
}

export interface UpdateInstallClickedProps {
  current_version: string;
  latest_version: string;
}

export type UpdateDismissAction = "remind_tomorrow" | "skip";

export interface UpdateDismissedProps {
  current_version: string;
  latest_version: string;
  action: UpdateDismissAction;
}

export interface VersionUpdatedProps {
  from_version: string;
  to_version: string;
}
