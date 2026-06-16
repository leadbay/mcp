import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext } from "../types.js";

import { leadbay_send_feedback as SEND_FEEDBACK_DESCRIPTION } from "../tool-descriptions.generated.js";

// User-authored feedback → the Leadbay team's Sentry feedback inbox, the SAME
// destination as the web app's feedback form (Sentry.captureFeedback). This is
// DISTINCT from leadbay_report_friction: friction is silent, agent-detected,
// PostHog-only telemetry; feedback is explicit, user-written, and reaches the
// team's inbox. The transport lives in the MCP server (ToolContext.sendFeedback
// → telemetry.captureFeedback) so core stays decoupled from @sentry/node.

export interface SendFeedbackParams {
  message: string;
  // Optional Sentry event id to attach the feedback to (e.g. the error the
  // user is complaining about), so the team sees feedback on the actual issue.
  associated_error_id?: string;
}

const MESSAGE_MAX = 4000;

export const sendFeedback: Tool<SendFeedbackParams> = {
  name: "leadbay_send_feedback",
  annotations: {
    title: "Send feedback to the Leadbay team",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  description: SEND_FEEDBACK_DESCRIPTION,
  // Write-gated: it sends data outward to the Leadbay team. Registered in
  // compositeWriteTools (default-on since 0.3.0).
  write: true,
  inputSchema: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description:
          "The user's feedback, in their own words. Confirm the wording with the user BEFORE calling — this is sent to the Leadbay team. Cap 4000 chars.",
      },
      associated_error_id: {
        type: "string",
        description:
          "Optional: a Sentry event id to attach this feedback to (e.g. the id from an error the user just hit), so the team sees the feedback on that exact issue.",
      },
    },
    required: ["message"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    description:
      "Whether the feedback reached the Leadbay team. `sent: true` means it landed in the team's inbox.",
    properties: {
      sent: { type: "boolean" },
      message: { type: "string" },
      _meta: {
        type: "object",
        properties: { region: { type: "string" } },
      },
    },
  },
  execute: async (
    client: LeadbayClient,
    params: SendFeedbackParams,
    ctx?: ToolContext
  ) => {
    const text = typeof params.message === "string" ? params.message.trim() : "";
    if (!text) {
      return {
        error: true,
        code: "BAD_INPUT",
        message: "message is required — pass the user's feedback text.",
        hint: "Ask the user what they'd like to tell the Leadbay team, then call again with their words in `message`.",
      };
    }
    // Slice to MESSAGE_MAX-1 so the appended ellipsis keeps the payload at the
    // advertised 4000-char cap (not 4001). The ellipsis signals truncation.
    const message =
      text.length > MESSAGE_MAX ? `${text.slice(0, MESSAGE_MAX - 1)}…` : text;

    // The transport is wired by the MCP server. If it's absent (telemetry off,
    // OpenClaw, tests) we must NOT claim success.
    if (!ctx?.sendFeedback) {
      return {
        sent: false,
        message:
          "Feedback could not be sent from this client (feedback delivery isn't available here). Let the user know it wasn't delivered.",
        _meta: { region: client.region },
      };
    }

    // associated_error_id is untrusted (agent-supplied) and crosses into a
    // backend (Sentry). Allow only a conservative id charset so injection-shaped
    // junk ("...; drop tables", whitespace, huge blobs) can't ride through as an
    // associatedEventId; drop anything else rather than forward it. Kept lenient
    // (not strict 32-hex) since the agent has no first-class source for a real
    // Sentry event id today — it's a best-effort attach, not a trusted key.
    const errorId =
      typeof params.associated_error_id === "string" &&
      /^[A-Za-z0-9_-]{1,64}$/.test(params.associated_error_id)
        ? params.associated_error_id
        : undefined;

    const sent = await ctx.sendFeedback(message, {
      ...(errorId ? { associatedEventId: errorId } : {}),
    });

    return {
      sent,
      message: sent
        ? "Sent to the Leadbay team — thanks for the feedback."
        : // `sent:false` means the bounded flush didn't confirm within the
          // window — the envelope may still drain on shutdown. Don't assert it
          // failed (that trains users to re-send and spam the inbox).
          "Delivery not confirmed — it may still reach the Leadbay team. Avoid re-sending unless the user wants to.",
      _meta: { region: client.region },
    };
  },
};
