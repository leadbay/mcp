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

export type ToolCallFormat = "json" | "markdown" | "error-envelope";

export interface ToolCallProps {
  tool: string;
  ok: boolean;
  duration_ms: number;
  format: ToolCallFormat;
  bytes: number;
  error_code?: string;
}

export interface QuotaHitProps {
  tool: string;
  retry_after_s?: number;
  endpoint?: string;
}

export interface TopupLinkProps {
  tool: string;
}

export interface ExceptionCtx {
  tool: string;
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
