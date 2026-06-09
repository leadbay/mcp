import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext, QuotaStatusPayload } from "../types.js";
import { withAgentMemoryMeta } from "../agent-memory/index.js";

import { leadbay_account_status as ACCOUNT_STATUS_DESCRIPTION } from "../tool-descriptions.generated.js";
export const accountStatus: Tool<Record<string, never>> = {
  name: "leadbay_account_status",
  annotations: {
    title: "Show Leadbay account + quota state",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: ACCOUNT_STATUS_DESCRIPTION,
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  outputSchema: {
    type: "object",
    properties: {
      user: {
        type: "object",
        description: "Identity & roles for the current bearer-token holder.",
        properties: {
          email: { type: ["string", "null"] },
          name: { type: ["string", "null"] },
          admin: { type: "boolean" },
          manager: { type: "boolean" },
          language: { type: "string" },
        },
      },
      organization: {
        type: "object",
        description: "Org-level state and feature flags.",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          ai_agent_enabled: { type: "boolean" },
          computing_intelligence: {
            type: "boolean",
            description:
              "True if Leadbay is mid-regenerating intelligence after a refine_prompt; new leads will reflect it shortly.",
          },
          plan: { type: ["string", "null"] },
        },
      },
      last_requested_lens: {
        type: ["number", "null"],
        description: "Most recent lens id the user pulled leads from.",
      },
      quota: {
        type: ["object", "null"],
        description:
          "Per-resource quota state (llm_completion, ai_rescore, web_fetch, LENS_EXTRA_REFILL) across daily/weekly/monthly windows. Null if /quota_status failed (see quota_error) or genuinely returned nothing. Pre-check the LENS_EXTRA_REFILL entry before calling leadbay_extend_lens.",
      },
      quota_error: {
        type: ["object", "null"],
        description:
          "Non-null ONLY when the quota_status call FAILED — {code, http_status, message}. A 401/403 means the token lacks quota scope: tell the user to reconnect / re-run OAuth. Treat as 'quota unreadable', NEVER as zero usage or 'no limits'.",
        properties: {
          code: { type: "string" },
          http_status: { type: ["number", "null"] },
          message: { type: "string" },
        },
      },
      notifications: {
        type: "array",
        description:
          "Terminal bulk-progress notifications the MCP knows about (background work the user or agent started that has since completed). Each entry carries notification_id, kind (bulk_enrich | bulk_qualify | import | other), bulk_progress counters, and a revise_hint pointing at prior agent outputs the just-finished work might have made stale. After revising affected outputs, call leadbay_acknowledge_notification(notification_id) to clear the entry. Empty array when nothing has completed.",
        items: { type: "object" },
      },
      _meta: {
        type: "object",
        properties: {
          region: { type: "string" },
          agent_memory: { type: "object" },
        },
      },
      // Auto-update block. Populated by the MCP server wrapper (NOT this
      // composite) when a newer release is published on GitHub AND the
      // user hasn't suppressed it. When present, the agent should prompt
      // the user via ask_user_input_v0 with three options and route the
      // chosen action through leadbay_acknowledge_update.
      update_available: {
        type: ["object", "null"],
        properties: {
          current_version: { type: "string" },
          latest_version: { type: "string" },
          mcpb_url: {
            type: "string",
            description: "Direct download URL for the .mcpb installer asset.",
          },
          release_url: {
            type: "string",
            description: "GitHub release page (changelog).",
          },
        },
        required: ["current_version", "latest_version", "mcpb_url", "release_url"],
      },
    },
    required: ["user", "organization"],
  },
  execute: async (client: LeadbayClient, _params, ctx?: ToolContext) => {
    const me = await client.resolveMe();

    let quota: QuotaStatusPayload | null = null;
    // Distinct from `quota: null`: when the call FAILS (e.g. 401/403 from a
    // token without quota scope) we surface the error so the agent can say
    // "quota access denied — reauth" instead of misreading silence as
    // "no usage / unlimited". A null quota with no error means the call
    // genuinely returned nothing.
    let quota_error: { code: string; http_status: number | null; message: string } | null = null;
    try {
      quota = await client.request<QuotaStatusPayload>(
        "GET",
        `/organizations/${me.organization.id}/quota_status`
      );
    } catch (err: any) {
      quota_error = {
        code: err?.code ?? "QUOTA_STATUS_FAILED",
        http_status: err?._meta?.http_status ?? null,
        message: err?.message ?? "quota_status request failed",
      };
      ctx?.logger?.warn?.(
        `account_status: quota_status failed: ${err?.message ?? err?.code ?? err}`
      );
    }

    return withAgentMemoryMeta(client, {
      user: {
        email: me.email ?? null,
        name: me.name ?? null,
        admin: me.admin ?? false,
        manager: me.manager ?? false,
        language: me.language ?? "en",
      },
      organization: {
        id: me.organization.id,
        name: me.organization.name,
        ai_agent_enabled: me.organization.ai_agent_enabled ?? false,
        computing_intelligence: me.organization.computing_intelligence ?? false,
        plan: quota?.plan ?? me.organization.quota_plan ?? null,
      },
      last_requested_lens: me.last_requested_lens ?? null,
      // Quota goes here verbatim from /quota_status. Legacy freemium.* fields
      // on /me are intentionally NOT surfaced — they're defunct (see
      // SHAPE-DRIFT.md probe round 4).
      quota,
      // Inbox of terminal bulk-progress notifications. Same shape the MCP
      // server attaches to `_meta.notifications` on every tool response —
      // duplicated here as a top-level field so the agent's daily-rhythm
      // check-in (this composite) sees them without having to read _meta.
      // Empty array when the WS listener isn't wired (OpenClaw, tests) OR
      // when nothing has completed since the last ack.
      notifications: ctx?.notificationsInbox?.list() ?? [],
      // Non-null ONLY when the quota_status call failed. The agent must treat
      // this as "could not read quota" (reauth on 401/403) — NOT as zero usage.
      quota_error,
      _meta: {
        region: client.region,
      },
    }, ctx, me.organization.id);
  },
};
