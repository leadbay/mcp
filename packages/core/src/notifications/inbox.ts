// Notifications inbox — in-memory store of terminal bulk-progress
// notifications the MCP knows about. Fed by:
//   1. The WS listener (notifications/ws-client.ts) on every
//      `type:"notification"` frame where bulk_progress is set AND
//      in_progress=false.
//   2. The REST catch-up pass (notifications/catch-up.ts) on every WS
//      (re)connect — covers anything that completed while MCP was down.
//
// Drained by:
//   - The MCP server's CallTool handler, which decorates every tool
//     response with `_meta.notifications`.
//   - The leadbay_account_status composite, which surfaces the same list as
//     a top-level `notifications` block.
//   - leadbay_acknowledge_notification, which removes an entry after the
//     agent has revised the affected output.

import type { Notification, NotificationInboxEntry } from "../types.js";
import { toInboxEntry } from "./revise-hint.js";

// Entries older than this are dropped on next list() call, even without an
// explicit ack. Keeps the inbox from accumulating stale entries forever if
// the agent never calls ack (e.g. unattended automation).
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

interface StoredEntry {
  entry: NotificationInboxEntry;
  recordedAt: number;
}

export interface NotificationsInboxOpts {
  ttl_ms?: number;
  now?: () => number;
}

export class NotificationsInbox {
  private entries = new Map<string, StoredEntry>();
  private readonly ttl_ms: number;
  private readonly now: () => number;

  constructor(opts: NotificationsInboxOpts = {}) {
    this.ttl_ms = opts.ttl_ms ?? DEFAULT_TTL_MS;
    this.now = opts.now ?? Date.now;
  }

  // Upsert by notification id. Latest write wins so duplicate arrivals
  // (WS event + REST catch-up landing the same row) collapse cleanly.
  record(n: Notification): void {
    // Only terminal bulk-progress notifications belong in the inbox.
    if (!n.bulk_progress) return;
    if (n.in_progress) return;
    const entry = toInboxEntry(n);
    this.entries.set(entry.notification_id, {
      entry,
      recordedAt: this.now(),
    });
  }

  list(): NotificationInboxEntry[] {
    this.expireStale();
    return [...this.entries.values()].map((e) => e.entry);
  }

  markSeen(notification_id: string): void {
    this.entries.delete(notification_id);
  }

  size(): number {
    this.expireStale();
    return this.entries.size;
  }

  private expireStale(): void {
    const cutoff = this.now() - this.ttl_ms;
    for (const [id, e] of this.entries) {
      if (e.recordedAt < cutoff) this.entries.delete(id);
    }
  }
}
