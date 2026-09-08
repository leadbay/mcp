/**
 * product#4085 — a backend `bad_request` 400 is the agent's argument, not
 * Leadbay's health.
 *
 * The backend answers a path or query parameter that fails to parse (an
 * 8-character lead id, a lens id that is not a number) with
 * `400 {"error":{"code":"bad_request","message":"bad 'leadId' parameter"}}`.
 * mapErrorResponse filed that under the API_ERROR catch-all, whose hint is
 * "Try again or check the Leadbay API status" — and an unattended agent did
 * exactly that, twenty times in 39 seconds. It is now BAD_INPUT: the backend
 * message verbatim, a hint that says the call fails the same way on retry.
 * Other 400 codes are domain answers and stay API_ERROR.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../src/client.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

// The production body, byte for byte (probed 2026-09-08 on api-fr).
const BAD_LEAD_ID = { error: { code: "bad_request", message: "bad 'leadId' parameter" } };

beforeEach(() => resetHttpMock());

describe("LeadbayClient — a backend bad_request 400 is BAD_INPUT, not API_ERROR", () => {
  it("names the parameter with the backend's own message and keeps the status", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/lenses/48110/leads/5585c198", status: 400, body: BAD_LEAD_ID },
    ]);
    await expect(newClient().request("GET", "/lenses/48110/leads/5585c198")).rejects.toMatchObject({
      error: true,
      code: "BAD_INPUT",
      message: "bad 'leadId' parameter",
      _meta: { http_status: 400, endpoint: "/lenses/48110/leads/5585c198" },
    });
  });

  it("tells the agent the same call will fail the same way — never 'Try again'", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/lenses/48110/leads/5585c198", status: 400, body: BAD_LEAD_ID },
    ]);
    let hint = "";
    try {
      await newClient().request("GET", "/lenses/48110/leads/5585c198");
      expect.fail("should have thrown");
    } catch (err: any) {
      hint = err.hint;
    }
    expect(hint).toContain("will fail the same way");
    expect(hint).toContain("parameter named in the message");
    expect(hint).not.toContain("Try again");
  });

  it("a 400 with any other backend code is still the API_ERROR catch-all", async () => {
    mockHttp([
      {
        method: "POST",
        path: "/1.6/contacts",
        status: 400,
        body: { error: { code: "duplicate", message: "contact already exists" } },
      },
    ]);
    await expect(newClient().request("POST", "/contacts", {})).rejects.toMatchObject({
      code: "API_ERROR",
      message: "contact already exists",
      _meta: { http_status: 400 },
    });
  });

  it("a 400 with no body at all is still the API_ERROR catch-all", async () => {
    mockHttp([{ method: "GET", path: "/1.6/lenses/x/leads/y", status: 400, body: {} }]);
    await expect(newClient().request("GET", "/lenses/x/leads/y")).rejects.toMatchObject({
      code: "API_ERROR",
    });
  });
});
