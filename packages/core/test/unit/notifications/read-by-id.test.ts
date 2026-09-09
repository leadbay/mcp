/**
 * Finding a job by id when the backend has no by-id endpoint (leadbay/mcp#197).
 *
 * The previous version scanned page 1 of the unarchived list only, which meant
 * our own `leadbay_acknowledge_notification(id, "archive")` could put a job
 * permanently out of reach, and a finished job behind 50 newer ones was
 * unreachable too.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { readNotificationById } from "../../../src/notifications/read-by-id.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");
const ID = "11d949d5-f4e9-4591-b106-f289b863b298";

const row = (id: string) => ({
  id,
  created_at: "2026-09-01T10:00:00Z",
  in_progress: false,
  links: [],
  bulk_progress: { total_count: 1, success_count: 1, failure_count: 0, quota_hit_count: 0 },
  file_import_id: null,
});
const page = (items: unknown[], pages = 1) => ({
  status: 200,
  body: { items, total_unseen: 0, pagination: { page: 0, pages, count: items.length } },
});

beforeEach(() => resetHttpMock());

describe("readNotificationById", () => {
  it("finds an unarchived job on the first page", async () => {
    mockHttp([{ method: "GET", path: /^\/1\.6\/notifications/, ...page([row(ID)]) }]);
    expect((await readNotificationById(newClient(), ID))?.id).toBe(ID);
  });

  it("finds a job the agent ARCHIVED — we ship the tool that archives it", async () => {
    mockHttp([
      { method: "GET", path: /archived=false/, ...page([row("other")]) },
      { method: "GET", path: /archived=true/, ...page([row(ID)]) },
    ]);
    expect((await readNotificationById(newClient(), ID))?.id).toBe(ID);
  });

  it("pages past the first 50 rather than giving up", async () => {
    mockHttp([
      { method: "GET", path: /archived=false&page=0/, ...page([row("newer")], 2) },
      { method: "GET", path: /archived=false&page=1/, ...page([row(ID)], 2) },
    ]);
    expect((await readNotificationById(newClient(), ID))?.id).toBe(ID);
  });

  it("returns null when it genuinely is not there", async () => {
    mockHttp([
      { method: "GET", path: /archived=false/, ...page([]) },
      { method: "GET", path: /archived=true/, ...page([]) },
    ]);
    expect(await readNotificationById(newClient(), ID)).toBeNull();
  });
});
