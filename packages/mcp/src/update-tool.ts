// leadbay_acknowledge_update — the user's response to the update prompt
// that account_status surfaced.
//
// The agent calls this with the action the user picked via the
// ask_user_input_v0 widget. The server:
//   * "install"        → emits mcp_update_install_clicked, returns the
//                        .mcpb URL + release URL so the agent can render
//                        a clickable link. Does NOT touch state — the
//                        next process boot under the new VERSION will
//                        fire mcp_version_updated on its own.
//   * "remind_tomorrow"→ writes remind_until = now + 24h, emits
//                        mcp_update_dismissed{action:"remind_tomorrow"}.
//   * "skip"           → appends version to suppressed_versions, emits
//                        mcp_update_dismissed{action:"skip"}.
//
// The tool lives in @leadbay/mcp (not @leadbay/core) because every
// dependency it touches — UpdateStateStore, TelemetryHandle, the .mcpb
// asset URL — is MCP-server-shaped. Built inside buildServer() with
// closures capturing the dependencies.

import type { LeadbayClient, Tool, ToolContext, ToolLogger } from "@leadbay/core";
import type { TelemetryHandle } from "./telemetry.js";
import type { UpdateStateStore } from "./update-state.js";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

interface AckArgs {
  action?: unknown;
  version?: unknown;
}

export interface BuildAcknowledgeUpdateToolOpts {
  stateStore: UpdateStateStore;
  telemetry: TelemetryHandle;
  currentVersion: string;
  logger?: ToolLogger;
  now?: () => number;
}

const DESCRIPTION =
  "Record the user's choice on an update prompt surfaced via `update_available` " +
  "on leadbay_account_status. Pass `action: 'install' | 'remind_tomorrow' | 'skip'` " +
  "and `version` (the `latest_version` from the prompt). On 'install', the server " +
  "returns `{ mcpb_url, release_url }` — show the user a clickable link to mcpb_url " +
  "so Claude Desktop's native installer opens it. On 'remind_tomorrow' the server " +
  "suppresses the prompt for 24 hours. On 'skip' the version is suppressed permanently. " +
  "Call this tool EXACTLY ONCE per prompt — do not loop, and do not call it " +
  "speculatively when no update_available block is present.";

export function buildAcknowledgeUpdateTool(
  opts: BuildAcknowledgeUpdateToolOpts
): Tool<AckArgs> {
  const now = opts.now ?? Date.now;
  return {
    name: "leadbay_acknowledge_update",
    annotations: {
      title: "Acknowledge a Leadbay MCP update prompt",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    description: DESCRIPTION,
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["install", "remind_tomorrow", "skip"],
          description:
            "What the user chose: 'install' (they'll click the link), " +
            "'remind_tomorrow' (suppress for 24h), or 'skip' (suppress this version permanently).",
        },
        version: {
          type: "string",
          description:
            "The latest_version string from the update_available block. " +
            "Used for suppression and event correlation.",
        },
      },
      required: ["action", "version"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        ok: { type: "boolean" },
        action: { type: "string" },
        version: { type: "string" },
        message: { type: "string" },
        mcpb_url: { type: ["string", "null"] },
        release_url: { type: ["string", "null"] },
      },
      required: ["ok", "action", "version", "message"],
    },
    execute: async (_client: LeadbayClient, args: AckArgs, _ctx?: ToolContext) => {
      const action = String(args?.action ?? "");
      const version = String(args?.version ?? "");
      if (action !== "install" && action !== "remind_tomorrow" && action !== "skip") {
        return {
          error: true as const,
          code: "INVALID_ARGUMENT",
          message: `Unknown action '${action}' for leadbay_acknowledge_update.`,
          hint: "Pass one of: 'install', 'remind_tomorrow', 'skip'.",
        };
      }
      if (!version) {
        return {
          error: true as const,
          code: "INVALID_ARGUMENT",
          message: "Missing required `version` argument.",
          hint: "Pass the latest_version string from the update_available block.",
        };
      }

      if (action === "install") {
        const state = await opts.stateStore.read();
        opts.telemetry.captureUpdateInstallClicked?.({
          current_version: opts.currentVersion,
          latest_version: version,
        });
        return {
          ok: true,
          action,
          version,
          mcpb_url: state.latest_known_mcpb_url ?? null,
          release_url: state.latest_known_release_url ?? null,
          message:
            state.latest_known_mcpb_url
              ? "Show the user the mcpb_url as a clickable link — opening it in Claude Desktop runs the native installer."
              : "No .mcpb URL is cached. Direct the user to the release_url to download manually.",
        };
      }

      if (action === "remind_tomorrow") {
        await opts.stateStore.update((cur) => ({
          ...cur,
          remind_until: now() + TWENTY_FOUR_HOURS_MS,
        }));
        opts.telemetry.captureUpdateDismissed?.({
          current_version: opts.currentVersion,
          latest_version: version,
          action: "remind_tomorrow",
        });
        return {
          ok: true,
          action,
          version,
          message: "Reminder snoozed for 24 hours. No further prompts will appear in that window.",
        };
      }

      // skip
      await opts.stateStore.update((cur) => ({
        ...cur,
        suppressed_versions: cur.suppressed_versions.includes(version)
          ? cur.suppressed_versions
          : [...cur.suppressed_versions, version],
      }));
      opts.telemetry.captureUpdateDismissed?.({
        current_version: opts.currentVersion,
        latest_version: version,
        action: "skip",
      });
      return {
        ok: true,
        action,
        version,
        message: `Version ${version} suppressed. Future releases will still prompt.`,
      };
    },
  };
}
