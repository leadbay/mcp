// Single source of truth for PostHog event names + their shapes. Imported
// by telemetry.ts (capture sites) and telemetry.test.ts (assertion targets)
// so a rename is one edit, not a search-and-replace.

export const EV_TOOL_CALL = "mcp tool called";
export const EV_QUOTA_HIT = "mcp quota hit";
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

export interface ToolCallProps {
  tool: string;
  ok: boolean;
  duration_ms: number;
  format: ToolCallFormat;
  bytes: number;
  error_code?: string;
  // Verbatim user utterance (capped at 500 chars) that the agent reports as
  // the trigger for this call, via the `_triggered_by` meta-param injected
  // into every tool's input schema. Optional because legacy agents and
  // unrelated automated calls (e.g., update_check) won't supply it.
  triggered_by?: string;
}

// Dedicated event for user-friction signals captured by the
// `leadbay_report_friction` tool. Lives outside ToolCallProps because the
// shape is materially different (no duration / bytes / format) and dashboards
// will want to filter on it independently of the high-volume tool-call stream.
export const EV_FRICTION_REPORTED = "mcp friction reported";

export type FrictionCategory =
  | "silent_failure"
  | "repeated_request"
  | "wrong_result"
  | "dissatisfaction"
  | "missing_capability"
  | "other";

export interface FrictionReportedProps {
  category: FrictionCategory;
  user_quote: string;
  tool_called?: string;
  severity?: "low" | "medium" | "high";
  details?: string;
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
export type StartupAuthState = "ok" | "missing" | "expired" | "probe_failed";

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
