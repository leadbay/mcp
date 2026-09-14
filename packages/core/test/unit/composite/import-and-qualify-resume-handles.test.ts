/**
 * `leadbay_import_and_qualify` has no qualification `notification_id`, and the
 * descriptions must not invent one.
 *
 * Its qualify phase is a per-lead `/web_fetch` fan-out, so the backend never
 * mints a qualification job for it — see the NOTE on `notification_ids` in
 * import-and-qualify.ts. What it hands back to resume with is `lead_ids` +
 * `lens_id`; `notification_ids[]` are the FILE-IMPORT notifications, and
 * `import_ids` are the wizard handles for `leadbay_import_status`.
 *
 * Four description surfaces briefly told the agent to carry a `notification_id`
 * from this tool to `leadbay_qualify_status`. Following that is not a no-op: the
 * kind check rejects it. These lock the contract the corrected prose describes.
 *
 * New file — existing import-and-qualify / qualify-status tests are not modified.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { importAndQualify } from "../../../src/composite/import-and-qualify.js";
import { qualifyStatus } from "../../../src/composite/qualify-status.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");
const NOTIF = "5faed710-a0a4-469a-bbbb-444b2b1e93d9";

const listing = (items: unknown[]) => ({
  method: "GET" as const,
  path: /^\/1\.6\/notifications/,
  status: 200,
  body: { items, total_unseen: 0, pagination: { page: 0, pages: 1, count: items.length } },
});

beforeEach(() => resetHttpMock());

describe("import_and_qualify — the ids it actually resumes with", () => {
  it("declares lead_ids + lens_id and no qualification notification_id", () => {
    const props = (importAndQualify.outputSchema as any).properties;
    expect(props).toHaveProperty("lead_ids");
    expect(props).toHaveProperty("lens_id");
    // The singular field the prose used to promise. Nothing returns it.
    expect(props).not.toHaveProperty("notification_id");
  });

  it("qualify_status accepts those ids with no notification_id at all", () => {
    // Without this branch the import_and_qualify resume path would have no
    // legal call shape, and the corrected description would be unfollowable.
    expect((qualifyStatus.inputSchema as any).anyOf).toContainEqual({
      required: ["lead_ids"],
    });
  });

  it("rejects a file-import notification and points at import_status", async () => {
    // What the old prose sent here: one of import_and_qualify's notification_ids.
    mockHttp([
      listing([
        {
          id: NOTIF,
          created_at: "2026-09-02T01:20:22Z",
          updated_at: "2026-09-02T01:21:38Z",
          first_seen_at: null,
          archived: false,
          language: "en",
          title: "Your file import has finished.",
          content: null,
          in_progress: false,
          links: [],
          bulk_progress: null,
          file_import_id: "imp-1",
        },
      ]),
    ]);
    await expect(
      qualifyStatus.execute(newClient(), { notification_id: NOTIF }, {})
    ).rejects.toMatchObject({ code: "QUALIFY_JOB_WRONG_KIND" });
  });
});
