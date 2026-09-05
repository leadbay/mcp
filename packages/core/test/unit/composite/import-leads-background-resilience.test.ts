/**
 * The detached background import must not be able to kill the process
 * (Codex review on leadbay/mcp#187).
 *
 * `runImportInBackground` runs in a `void` IIFE. Anything that escapes it is an
 * unhandled rejection, and on the hosted server that is one process shared by
 * every tenant — so one user's failing import would end everyone's session.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { resetLaunchGuard } from "../../../src/jobs/launch-guard.js";
import { LeadbayClient } from "../../../src/client.js";
import { importLeads } from "../../../src/composite/import-leads.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");
const ME = { id: "u", email: "t@e.com", organization: { id: "org-A" }, admin: true };
const settle = () => new Promise((r) => setTimeout(r, 120));

beforeEach(() => {
  resetHttpMock();
  resetLaunchGuard();
});

describe("background import resilience (product#4005)", () => {
  it("a failing backend call does not escape the detached task", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/users/me", status: 200, body: ME },
      {
        method: "POST",
        path: /^\/1\.6\/imports\?file_name=/,
        status: 200,
        body: { id: "imp-1", pre_processing: { finished: true }, processing: { finished: true } },
      },
      {
        method: "GET",
        path: "/1.6/imports/imp-1",
        status: 200,
        body: { id: "imp-1", pre_processing: { finished: true }, processing: { finished: true } },
      },
      // The background half fails.
      { method: "POST", path: "/1.6/imports/imp-1/update_mappings", status: 500, body: { message: "boom" } },
    ]);

    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    try {
      const res: any = await importLeads.execute(
        newClient(),
        { domains: [{ domain: "acme.com" }], wait_for_completion: false },
        {}
      );
      // The caller still gets the backend ids it polls with.
      expect(res.importIds).toEqual(["imp-1"]);
      await settle();
      await settle();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toEqual([]);
  });
});
