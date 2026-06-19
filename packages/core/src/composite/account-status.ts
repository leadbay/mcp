import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext, QuotaStatusPayload, LensPayload } from "../types.js";
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
        type: ["string", "null"],
        description:
          "The most recent lens id (a STRING, e.g. \"40005\"). WITHHELD (null) unless the user's message asked about the lens/audience — the composite only populates it when asked, so a plain 'what account?' answer has no lens to show. Even when present, this raw id is internal routing only — NEVER show the number to the user; use `last_requested_lens_name`.",
      },
      last_requested_lens_name: {
        type: ["string", "null"],
        description:
          "Human-readable name of the active lens (resolved from /lenses). WITHHELD (null) unless the user explicitly asked about the lens/audience — the composite only resolves it when asked, so on a plain account question there is nothing here to mention. When present (the user asked), answer with THIS name, never the numeric id.",
      },
      quota: {
        type: ["object", "null"],
        description:
          "Per-resource quota state (llm_completion, ai_rescore, web_fetch, LENS_EXTRA_REFILL) across daily/weekly/monthly windows. Null if /quota_status failed (see quota_error) or genuinely returned nothing. Pre-check the LENS_EXTRA_REFILL entry before calling leadbay_extend_lens.",
      },
      quota_error: {
        type: ["object", "null"],
        description:
          "Non-null ONLY when the quota_status call FAILED — {code, http_status, message}. This is an INTERNAL diagnostic — do NOT surface it to the user AT ALL. A 401/403 here does NOT mean the login is broken: the `user`/`organization` fields in THIS SAME response were fetched with the same token and succeeded. It's a backend-side quirk (commonly an org with no billing plan — `plan: null`), irrelevant to the user. When quota is unreadable: stay SILENT — do NOT mention quota, do NOT say 'quota unreadable', do NOT mention any error or 401, and NEVER tell the user to reconnect or re-authenticate. Just answer the rest (user / org / lens) and omit quota entirely. NEVER report it as zero usage or 'no limits' either.",
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
          install_url: {
            type: "string",
            description: "Direct download URL for the installer asset (.dxt, falling back to .mcpb).",
          },
          release_url: {
            type: "string",
            description: "GitHub release page (changelog).",
          },
        },
        required: ["current_version", "latest_version", "install_url", "release_url"],
      },
    },
    required: ["user", "organization"],
  },
  execute: async (client: LeadbayClient, _params, ctx?: ToolContext) => {
    const me = await client.resolveMe();

    let quota: QuotaStatusPayload | null = null;
    // Distinct from `quota: null`: when the call FAILS we surface the error so
    // the agent says "quota unreadable" instead of misreading silence as
    // "no usage / unlimited". A null quota with no error means the call
    // genuinely returned nothing. NOTE: a 401/403 here is NOT an auth failure —
    // /users/me above used the same token and succeeded. The quota endpoint
    // 401s for orgs with no billing plan (plan: null); see quota_error's
    // description for the agent-facing framing (product#3761).
    let quota_error: { code: string; http_status: number | null; message: string } | null = null;
    try {
      quota = await client.request<QuotaStatusPayload>(
        "GET",
        `/organizations/${me.organization.id}/quota_status`
      );
    } catch (err: any) {
      const status: number | null = err?._meta?.http_status ?? null;
      // A 401/403 on quota_status is NOT an auth failure — /users/me above used
      // the same token and succeeded. It's a backend quirk for plan-less orgs
      // (plan: null) and is irrelevant to the user (product#3761). Do NOT put it
      // in the payload at all: prompt guidance alone was leaky — the agent still
      // hedged with "quota had a brief hiccup". Withholding it from the response
      // is the only way the agent literally cannot surface it. We still log it.
      // Non-auth failures (500, network) DO surface as quota_error so the agent
      // can legitimately say quota is unreadable for a real reason.
      if (status === 401 || status === 403) {
        ctx?.logger?.warn?.(
          `account_status: quota_status ${status} (plan-less org / backend quirk) — withheld from payload`
        );
      } else {
        quota_error = {
          code: err?.code ?? "QUOTA_STATUS_FAILED",
          http_status: status,
          message: err?.message ?? "quota_status request failed",
        };
        ctx?.logger?.warn?.(
          `account_status: quota_status failed: ${err?.message ?? err?.code ?? err}`
        );
      }
    }

    // The lens is gated on what the user ACTUALLY asked (product#3761). A plain
    // "what account am I connected to?" is NOT a lens question, and prompt
    // guidance alone leaked the lens unprompted in ~1/3 of live runs. So we only
    // surface ANYTHING lens-related when the trigger text mentions the lens /
    // audience. When not asked, both the id and the resolved name are withheld
    // from the payload entirely — the agent literally cannot volunteer what it
    // can't see. Safe failure: an unusual phrasing that misses the keywords just
    // omits the lens (never leaks it). When asked, we resolve the human NAME so
    // the agent answers with it, never the raw numeric id.
    const lensId = me.last_requested_lens ?? null;
    const lensAsked =
      typeof ctx?.triggered_by === "string" &&
      /\b(lens|lenses|audience|targeting|segment|filter)\b/i.test(ctx.triggered_by);

    let last_requested_lens_name: string | null = null;
    if (lensAsked && lensId != null) {
      try {
        const lenses = await client.request<LensPayload[]>("GET", "/lenses");
        // Lens ids are STRINGS server-side (e.g. "40005") — see my-lenses.ts.
        // `me.last_requested_lens` may be a number, so a strict `===` silently
        // misses ("40005" === 40005 is false), leaving the name null. Normalize
        // both sides to string before matching, as my-lenses.ts does.
        const wantId = String(lensId);
        last_requested_lens_name =
          lenses.find((l) => String(l.id) === wantId)?.name ?? null;
      } catch (err: any) {
        ctx?.logger?.warn?.(
          `account_status: lens-name resolve failed: ${err?.message ?? err?.code ?? err}`
        );
      }
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
      // Lens is withheld unless the user asked (lensAsked, above). When present,
      // the id is normalized to the STRING form (my-lenses.ts) so it matches the
      // schema and never drifts string-vs-number across accounts.
      last_requested_lens: lensAsked && lensId != null ? String(lensId) : null,
      last_requested_lens_name,
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
      // this as "could not read quota" — NOT as zero usage, and NOT as a broken
      // login (the token just authenticated /users/me above). product#3761.
      quota_error,
      _meta: {
        region: client.region,
      },
    }, ctx, me.organization.id);
  },
};
