/**
 * /.well-known/openai-apps-challenge — the domain proof for the OpenAI Apps
 * directory.
 *
 * The submission form fetches this URL unauthenticated and compares the body,
 * byte for byte, to the token it issued. Two ways that silently breaks and the
 * app fails verification with no server-side error to read:
 *
 *   1. The route sits behind an auth gate and answers 401 instead of the token.
 *   2. The body gains a trailing newline or JSON quoting and stops matching.
 *
 * Both are asserted here. `app.fetch(new Request())` is enough — unlike the MCP
 * routes this is a plain GET with no transport to drive.
 *
 * New file — does not modify the existing http-* tests.
 */

import { describe, it, expect, vi } from "vitest";
import { httpsMockFactory } from "../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { app } from "../../src/http-server.js";

const URL_PATH = "http://localhost/.well-known/openai-apps-challenge";

describe("/.well-known/openai-apps-challenge", () => {
  it("serves the token to an unauthenticated request", async () => {
    const res = await app.fetch(new Request(URL_PATH));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("vsJ51IZ_3AqM10YZxXQFmB29IGIMDOZGbpbEgRIT4r4");
  });

  it("sends the bare token — no newline, no quotes, no JSON envelope", async () => {
    const body = await (await app.fetch(new Request(URL_PATH))).text();
    expect(body).toBe(body.trim());
    expect(body.startsWith('"')).toBe(false);
    expect(() => JSON.parse(body)).toThrow();
  });

  it("does not require a bearer token", async () => {
    // Same request the OpenAI verifier makes: no Authorization header at all.
    const res = await app.fetch(new Request(URL_PATH));
    expect(res.status).not.toBe(401);
    expect(res.headers.get("www-authenticate")).toBeNull();
  });
});
