// REST catch-up — runs at MCP cold start and on every WS (re)connect.
//
// The MCP process dies whenever the host closes; on the next launch the WS
// reconnects from scratch and we'd lose any completion that landed in
// between. Likewise a transient network blip during a long-running import
// would drop the WS event. REST catch-up plugs both holes: list the recent
// notifications, filter to terminal bulk-progress rows the agent hasn't
// acknowledged yet, seed them into the inbox.

import type { LeadbayClient } from "../client.js";
import type { Notification, NotificationInboxEntry, ToolLogger } from "../types.js";
import type { NotificationsInbox } from "./inbox.js";
import { toInboxEntry } from "./revise-hint.js";

const DEFAULT_COUNT = 50;

export interface CatchUpOpts {
  count?: number;
  logger?: ToolLogger;
}

// Returns how many fresh entries were added to the inbox so the caller can
// log a heads-up. Errors are swallowed (logged) — catch-up is best-effort
// and must never bring the MCP down on a transient REST hiccup.
// The one definition of "a notification the agent still needs to act on":
// finished bulk work the user hasn't already dismissed on another surface.
// Both the inbox seeding below and the inbox-less read used by
// leadbay_account_status on the hosted server go through this, so the two
// surfaces can never disagree about what counts.
export function isTerminalUnseen(n: Notification): boolean {
  if (!n.bulk_progress) return false;
  if (n.in_progress) return false;
  if (n.first_seen_at) return false;
  return true;
}

/**
 * Read the backend's notifications ledger and return the terminal, unseen
 * entries directly — no inbox involved (product#4009).
 *
 * The hosted server has no inbox and cannot have one: the WS listener that
 * feeds it authenticates with a per-account ticket (`GET /auth/ws`), which
 * makes no sense on a multi-tenant process, and the streamable transport
 * builds a fresh `Server` per request so nothing survives to be cached
 * anyway. `GET /notifications` is already per-account and already durable, so
 * on that surface the ledger IS the inbox and this reads it on demand.
 *
 * Errors resolve to `[]` rather than throwing: a notifications hiccup must
 * never take down the account-status check-in that carries them.
 */
export async function fetchTerminalNotifications(
  client: LeadbayClient,
  opts: CatchUpOpts = {}
): Promise<NotificationInboxEntry[]> {
  try {
    const page = await client.listNotifications({
      archived: false,
      page: 0,
      count: opts.count ?? DEFAULT_COUNT,
    });
    return page.items.filter(isTerminalUnseen).map(toInboxEntry);
  } catch (err: any) {
    opts.logger?.warn?.(
      `notifications.fetch_terminal failed: ${err?.message ?? err?.code ?? err}`
    );
    return [];
  }
}

export async function catchUpNotifications(
  client: LeadbayClient,
  inbox: NotificationsInbox,
  opts: CatchUpOpts = {}
): Promise<number> {
  const count = opts.count ?? DEFAULT_COUNT;
  let added = 0;
  try {
    const page = await client.listNotifications({
      archived: false,
      page: 0,
      count,
    });
    for (const n of page.items) {
      if (!isTerminalUnseen(n)) continue;
      const sizeBefore = inbox.size();
      inbox.record(n);
      if (inbox.size() > sizeBefore) added += 1;
    }
    opts.logger?.info?.(
      `notifications.catch_up scanned=${page.items.length} seeded=${added}`
    );
  } catch (err: any) {
    opts.logger?.warn?.(
      `notifications.catch_up failed: ${err?.message ?? err?.code ?? err}`
    );
  }
  return added;
}
