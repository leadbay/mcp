import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext, QuotaStatusPayload } from "../types.js";

export const accountStatus: Tool<Record<string, never>> = {
  name: "leadbay_account_status",
  description:
    "Show the user's account state — admin rights, language, last-active lens, current quota usage across " +
    "daily/weekly/monthly windows for llm_completion / ai_rescore / web_fetch resources, and whether the org's " +
    "intelligence is mid-regeneration. Quota windows also hint at the user's consumption pace: heavy recent " +
    "activity (ai_rescore / web_fetch near their window limits) is a signal that Leadbay will deliver a larger " +
    "fresh batch next time the user logs back in, since batch size is paced by real consumption. " +
    "When to use: at the start of a session to know what the agent can/can't do, or after a 429 to explain to " +
    "the user which resource window was exhausted and when it resets. " +
    "When NOT to use: as a pre-flight gate before bulk ops — operations themselves return 429; this tool is " +
    "for context, not gating.",
  inputSchema: { type: "object", properties: {} },
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
