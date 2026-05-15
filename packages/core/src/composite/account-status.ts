import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext, QuotaStatusPayload } from "../types.js";

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
          "Per-resource quota state (llm_completion, ai_rescore, web_fetch) across daily/weekly/monthly windows. Null if /quota_status failed (logged in stderr).",
      },
      _meta: {
        type: "object",
        properties: { region: { type: "string" } },
      },
    },
    required: ["user", "organization"],
  },
  execute: async (client: LeadbayClient, _params, ctx?: ToolContext) => {
    const me = await client.resolveMe();

    let quota: QuotaStatusPayload | null = null;
    try {
      quota = await client.request<QuotaStatusPayload>(
        "GET",
        `/organizations/${me.organization.id}/quota_status`
      );
    } catch (err: any) {
      ctx?.logger?.warn?.(
        `account_status: quota_status failed: ${err?.message ?? err?.code ?? err}`
      );
    }

    return {
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
      _meta: {
        region: client.region,
      },
    };
  },
};
