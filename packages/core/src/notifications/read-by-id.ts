/**
 * Find one notification by id.
 *
 * The backend exposes a list endpoint and per-id mutations, but no
 * GET /notifications/{id} — verified against leadbay/backend main. So this is a
 * scan, and it has to compensate for that honestly:
 *
 *  - It looks in the ARCHIVED set too. We ship
 *    `leadbay_acknowledge_notification(id, "archive")`, so an agent can put a
 *    job out of its own reach; an archived job is still a real job.
 *  - It pages, bounded. A finished job sitting behind newer notifications is
 *    otherwise unreachable, since ordering is updatedAt DESC.
 *
 * It can still miss, which is why the status tools accept `lead_ids` and answer
 * without it. If a by-id endpoint lands, replace the body and the callers do
 * not change.
 */

import type { LeadbayClient } from "../client.js";
import type { Notification } from "../types.js";

const PAGE_SIZE = 50;
// Bounded so a status poll cannot walk an unbounded history.
const MAX_PAGES = 4;

export async function readNotificationById(
  client: LeadbayClient,
  notificationId: string
): Promise<Notification | null> {
  for (const archived of [false, true]) {
    for (let page = 0; page < MAX_PAGES; page += 1) {
      let res;
      try {
        res = await client.listNotifications({ archived, page, count: PAGE_SIZE });
      } catch {
        return null;
      }
      const hit = res.items.find((n) => n.id === notificationId);
      if (hit) return hit;
      const pages = res.pagination?.pages ?? 1;
      if (page + 1 >= pages) break;
    }
  }
  return null;
}
