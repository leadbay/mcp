/**
 * Rewritten for leadbay/product#4005: the handle is the backend's importIds.
 * There is no local record to seed, resolve, or lose.
 *
 * Unit tests for leadbay_import_status.
 */

import { resetLaunchGuard } from "../../../src/jobs/launch-guard.js";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
  getHttpRequests,
} from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { importStatus } from "../../../src/composite/import-status.js";

const BASE = "https://api-us.leadbay.app";

function newClient() {
  return new LeadbayClient(BASE, "u.tok", "us");
}

let tmpDirs: string[] = [];

beforeEach(() => {
  resetHttpMock();
  resetLaunchGuard();
  tmpDirs = [];
});

afterEach(async () => {
  await Promise.all(tmpDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("leadbay_import_status — polls the backend by importIds", () => {
  it("reports progress from the backend rows", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.6/imports/imp-1",
        status: 200,
        body: {
          id: "imp-1",
          pre_processing: { finished: true },
          processing: { finished: false },
        },
      },
    ]);
    const out: any = await importStatus.execute(newClient(), { importIds: ["imp-1"] });
    expect(out.status).toBe("running");
    expect(out.importIds).toEqual(["imp-1"]);
  });

  it("a non-dry-run import is not complete after preprocess alone", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.6/imports/imp-1",
        status: 200,
        body: {
          id: "imp-1",
          pre_processing: { finished: true },
          processing: { finished: false },
        },
      },
    ]);
    const out: any = await importStatus.execute(newClient(), {
      importIds: ["imp-1"],
      dry_run: false,
    });
    expect(out.status).toBe("running");
  });

  it("a dry run IS complete after preprocess", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.6/imports/imp-1",
        status: 200,
        body: {
          id: "imp-1",
          pre_processing: { finished: true },
          processing: { finished: false },
        },
      },
    ]);
    const out: any = await importStatus.execute(newClient(), {
      importIds: ["imp-1"],
      dry_run: true,
    });
    expect(out.status).toBe("complete");
  });

  it("reports completion once the backend says processing finished", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.6/imports/imp-1",
        status: 200,
        body: {
          id: "imp-1",
          pre_processing: { finished: true },
          processing: { finished: true },
        },
      },
    ]);
    const out: any = await importStatus.execute(newClient(), { importIds: ["imp-1"] });
    expect(out.status).toBe("complete");
  });

  it("surfaces a backend-side import failure", async () => {
    mockHttp([
      {
        method: "GET",
        path: "/1.6/imports/imp-1",
        status: 200,
        body: {
          id: "imp-1",
          pre_processing: { finished: true, error: "bad csv" },
          processing: { finished: false },
        },
      },
    ]);
    const out: any = await importStatus.execute(newClient(), { importIds: ["imp-1"] });
    expect(out.status).toBe("failed");
    expect(out.error).toBe("bad csv");
  });

  it("resolves the SAME importIds from a fresh client — nothing is held locally", async () => {
    // The point of the change: a different process, a different day, the same
    // answer, because the backend owns the import.
    const row = {
      id: "imp-1",
      pre_processing: { finished: true },
      processing: { finished: true },
    };
    mockHttp([
      { method: "GET", path: "/1.6/imports/imp-1", status: 200, body: row },
      { method: "GET", path: "/1.6/imports/imp-1", status: 200, body: row },
    ]);
    const first: any = await importStatus.execute(newClient(), { importIds: ["imp-1"] });
    const second: any = await importStatus.execute(newClient(), { importIds: ["imp-1"] });
    expect(second).toMatchObject({ status: first.status, importIds: first.importIds });
  });

  it("with no importIds it says what to pass", async () => {
    mockHttp([]);
    await expect(importStatus.execute(newClient(), {})).rejects.toMatchObject({
      code: "IMPORT_STATUS_INPUT_REQUIRED",
    });
  });
});
