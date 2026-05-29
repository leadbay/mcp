// REST catch-up — runs at MCP cold start and on every WS (re)connect.
//
// The MCP process dies whenever the host closes; on the next launch the WS
// reconnects from scratch and we'd lose any completion that landed in
// between. Likewise a transient network blip during a long-running import
// would drop the WS event. REST catch-up plugs both holes: list the recent
// notifications, filter to terminal bulk-progress rows the agent hasn't
// acknowledged yet, seed them into the inbox.

import type { LeadbayClient } from "../client.js";
import type { ToolLogger } from "../types.js";
import type { NotificationsInbox } from "./inbox.js";

const DEFAULT_COUNT = 50;

export interface CatchUpOpts {
  count?: number;
  logger?: ToolLogger;
}

// Returns how many fresh entries were added to the inbox so the caller can
// log a heads-up. Errors are swallowed (logged) — catch-up is best-effort
// and must never bring the MCP down on a transient REST hiccup.
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
      // Skip non-bulk notifications and still-in-progress rows. Skip rows
      // the user has already marked seen on another surface (FE dropdown).
      if (!n.bulk_progress) continue;
      if (n.in_progress) continue;
      if (n.first_seen_at) continue;
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
