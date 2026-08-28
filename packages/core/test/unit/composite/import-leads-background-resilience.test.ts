/**
 * The detached background import must not be able to kill the process
 * (Codex review on leadbay/mcp#187).
 *
 * Both matter specifically because leadbay/mcp#187 gives the hosted server a
 * bulk tracker. Before it, `runImportInBackground` returned immediately
 * (`if (!tracker) return`), so neither path ran on hosted at all. Now they do —
 * in a single multi-tenant process shared by every user.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { importLeads } from "../../../src/composite/import-leads.js";
import { InMemoryBulkStore } from "../../../src/jobs/bulk-store.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");
const ME = { id: "u", email: "t@e.com", organization: { id: "org-A" }, admin: true };

const settle = () => new Promise((r) => setTimeout(r, 600));

beforeEach(() => resetHttpMock());

describe("background import resilience (product#4005)", () => {
  it("a store that fails while recording failure does not escape the detached task", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: ME },
      { method: "POST", path: /^\/1\.6\/imports\?file_name=/, status: 200,
        body: { id: "imp-1", pre_processing: { finished: true }, processing: { finished: true } } },
      // Mappings fail -> background task takes its catch branch.
      { method: "GET", path: "/1.6/imports/imp-1", status: 200,
        body: { id: "imp-1", pre_processing: { finished: true }, processing: { finished: true } } },
      { method: "POST", path: "/1.6/imports/imp-1/update_mappings", status: 500, body: { message: "boom" } },
    ]);
    const tracker = new InMemoryBulkStore();
    // Both writes reject: the completion AND the failure record. Before the
    // fix the second one was awaited with no outer catch, so it surfaced as an
    // unhandled rejection — process death on the shared hosted server.
    vi.spyOn(tracker, "markImportComplete").mockRejectedValue(new Error("store gone"));
    vi.spyOn(tracker, "markImportFailed").mockRejectedValue(new Error("store gone"));

    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    try {
      await importLeads.execute(
        newClient(),
        { domains: [{ domain: "acme.com" }], wait_for_completion: false },
        { bulkTracker: tracker } as any
      );
      await settle();
      await settle();
    } finally {
      process.off("unhandledRejection", onUnhandled);
      vi.restoreAllMocks();
    }
    expect(unhandled).toEqual([]);
  });
});
