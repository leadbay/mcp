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
    const message = text.length > MESSAGE_MAX ? `${text.slice(0, MESSAGE_MAX)}…` : text;

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

    const sent = await ctx.sendFeedback(message, {
      ...(params.associated_error_id
        ? { associatedEventId: params.associated_error_id }
        : {}),
    });

    return {
      sent,
      message: sent
        ? "Sent to the Leadbay team — thanks for the feedback."
        : "Feedback could not be delivered right now. Let the user know it wasn't sent.",
      _meta: { region: client.region },
    };
  },
};
