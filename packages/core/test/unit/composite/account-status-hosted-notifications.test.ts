/**
 * product#4009 — on the hosted server `account_status.notifications` was
 * permanently `[]`.
 *
 * `buildServerFromClient` never passes a `notificationsInbox`, and it cannot
 * meaningfully: the WS listener that fills the inbox authenticates with a
 * per-account ticket, which makes no sense on a multi-tenant process, and the
 * streamable transport builds a fresh Server per request so nothing would
 * survive to be cached. `ctx.notificationsInbox` was therefore undefined and
 * the daily-rhythm channel silently did not exist for hosted users.
 *
 * The fix reads the backend ledger directly when there is no inbox. These
 * cover both surfaces and the failure mode.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory, getHttpRequests } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { accountStatus } from "../../../src/composite/account-status.js";
import { NotificationsInbox } from "../../../src/notifications/inbox.js";

const BASE = "https://api-us.leadbay.app";
const ORG = "org-4009";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

const ME = {
  email: "victor@example.test",
  name: "Victor",
  admin: true,
  manager: false,
  language: "fr",
  organization: { id: ORG, name: "Acme", ai_agent_enabled: true, computing_intelligence: false },
  last_requested_lens: null,
};

const DONE = {
  id: "notif-done",
  created_at: "2026-09-01T08:00:00Z",
  updated_at: "2026-09-01T08:12:00Z",
  first_seen_at: null,
  archived: false,
  language: "fr",
  title: "Enrichissement terminé",
  content: null,
  in_progress: false,
  links: [{ type: "bulk_enrichment", id: "bulk-1" }],
  bulk_progress: { total: 10, done: 10, failure_count: 0 },
  file_import_id: null,
};
const RUNNING = { ...DONE, id: "notif-running", in_progress: true };
const ALREADY_SEEN = { ...DONE, id: "notif-seen", first_seen_at: "2026-09-01T09:00:00Z" };
const NOT_BULK = { ...DONE, id: "notif-plain", bulk_progress: null };

function baseCalls() {
  return [
    { method: "GET" as const, path: "/1.6/users/me", status: 200, body: ME },
    { method: "GET" as const, path: "/1.6/users/me", status: 200, body: ME },
    { method: "GET" as const, path: `/1.6/organizations/${ORG}/quota_status`, status: 200, body: {} },
  ];
}

beforeEach(() => resetHttpMock());

describe("product#4009 — hosted account_status reads the notifications ledger", () => {
  it("with no inbox, terminal notifications come from the backend instead of []", async () => {
    mockHttp([
      ...baseCalls(),
      {
        method: "GET",
        path: /^\/1\.6\/notifications\?/,
        status: 200,
        body: { items: [DONE, RUNNING, ALREADY_SEEN, NOT_BULK], pagination: { page: 0, pages: 1, total: 4 } },
      },
    ]);

    // No ctx at all — exactly what buildServerFromClient produces on hosted.
    const r: any = await accountStatus.execute(newClient(), {});

    // Only the finished, unseen, bulk row. Before the fix this was [].
    expect(r.notifications.map((n: any) => n.notification_id)).toEqual(["notif-done"]);
  });

  it("with an inbox wired (stdio), the ledger is NOT called", async () => {
    mockHttp(baseCalls());
    const inbox = new NotificationsInbox();
    inbox.record(DONE as any);

    const r: any = await accountStatus.execute(newClient(), {}, {
      notificationsInbox: inbox,
    } as any);

    expect(r.notifications.map((n: any) => n.notification_id)).toEqual(["notif-done"]);
    // The stdio path must stay free: the WS listener already has the answer.
    const hitLedger = getHttpRequests().some((q) => q.path.startsWith("/1.6/notifications"));
    expect(hitLedger).toBe(false);
  });

  it("a notifications failure degrades to [] and never breaks the check-in", async () => {
    mockHttp([
      ...baseCalls(),
      { method: "GET", path: /^\/1\.6\/notifications\?/, status: 500, body: { code: "boom" } },
    ]);

    const r: any = await accountStatus.execute(newClient(), {});

    // account_status is the daily entry point. A notifications hiccup must not
    // take it down — the account payload still answers.
    expect(r.notifications).toEqual([]);
    expect(r.user.email).toBe("victor@example.test");
  });
});
