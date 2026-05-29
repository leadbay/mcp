import type { LeadbayClient } from "../client.js";
import type { Tool, ToolContext } from "../types.js";

import { leadbay_acknowledge_notification as ACKNOWLEDGE_NOTIFICATION_DESCRIPTION } from "../tool-descriptions.generated.js";

interface AcknowledgeNotificationParams {
  notification_id: string;
  archive?: boolean;
}

// Strict UUIDv4 check. Notification ids in the inbox are server-minted UUIDs;
// reject malformed input before issuing the POST.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const acknowledgeNotification: Tool<AcknowledgeNotificationParams> = {
  name: "leadbay_acknowledge_notification",
  annotations: {
    title: "Acknowledge a Leadbay notification",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  description: ACKNOWLEDGE_NOTIFICATION_DESCRIPTION,
  write: true,
  inputSchema: {
    type: "object",
    properties: {
      notification_id: {
        type: "string",
        description:
          "UUID of the notification to acknowledge. Use the notification_id from `_meta.notifications[]` or `account_status.notifications[]`.",
      },
      archive: {
        type: "boolean",
        description:
          "If true, archive the notification (won't appear in `archived=false` listings). If false / omitted, mark seen (resets firstSeenAt).",
      },
    },
    required: ["notification_id"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      acknowledged: { type: "boolean" },
      notification_id: { type: "string" },
      action: { type: "string", enum: ["seen", "archive"] },
    },
    required: ["acknowledged", "notification_id", "action"],
  },
  execute: async (
    client: LeadbayClient,
    params: AcknowledgeNotificationParams,
    ctx?: ToolContext
  ) => {
    if (!UUID_RE.test(params.notification_id)) {
      return {
        error: true,
        code: "BAD_INPUT",
        message: "notification_id must be a UUID",
        hint:
          "Pass the notification_id verbatim from _meta.notifications[].notification_id or account_status.notifications[].notification_id.",
      };
    }
    const action: "seen" | "archive" = params.archive ? "archive" : "seen";
    await client.acknowledgeNotification(params.notification_id, action);
    // Drop the entry from the local inbox so subsequent _meta.notifications
    // payloads stop carrying it. The MCP server's WS listener will not
    // re-record it (we only record terminal-progress notifications, and
    // firstSeenAt being set is the explicit "client knows" signal — but
    // the WS push doesn't re-emit on seen, so this is purely local).
    ctx?.notificationsInbox?.markSeen(params.notification_id);
    return {
      acknowledged: true,
      notification_id: params.notification_id,
      action,
    };
  },
};
