/**
 * One-time "intro to Arty" — bounded /me wait (leadbay/product#3829 review).
 *
 * The intro is a UX nicety: it must NEVER hold a successful tool response
 * hostage to a slow/hung `GET /users/me` (core's httpsRequest sets no socket
 * timeout). `maybeAttachIntro` races the shared /me-read against
 * INTRO_SURFACE_WAIT_MS (1500ms) — if the read isn't ready in time, the tool
 * result returns WITHOUT `_meta.intro`, and the session gate stays open so a
 * later call can still surface the intro once /me is warm.
 *
 * This file uses its OWN delayed https mock (not the shared harness, which has
 * no latency knob) so it can drive the timeout branch deterministically.
 *
 * New file (never modify existing test files — repo invariant).
 */

import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";

// A local https mock with a per-path delay. `GET /users/me` is answered after
// `ME_DELAY_MS`; everything else answers immediately. Kept entirely inside this
// file so it doesn't touch the shared harness.
const ME_DELAY_MS = 1800; // > INTRO_SURFACE_WAIT_MS (1500ms)

function delayedHttpsRequest(options: any, callback?: (res: any) => void): any {
  const method = options.method ?? "GET";
  const path = options.path ?? "/";
  const req = new EventEmitter() as any;
  req.write = () => {};
  req.end = () => {
    const isMe = method === "GET" && /\/users\/me$/.test(path);
    const respond = () => {
      const res = new EventEmitter() as any;
      if (isMe) {
        res.statusCode = 200;
        res.headers = {};
        if (callback) callback(res);
        res.emit(
          "data",
          Buffer.from(
            JSON.stringify({
              id: "u",
              email: "a@b.co",
              name: "Tester",
              organization: { id: "org-1", name: "Org", ai_agent_enabled: true },
              arty_intro_shown: false,
            }),
            "utf8"
          )
        );
        res.emit("end");
      } else {
        // e.g. the setter POST — 204 no body.
        res.statusCode = 204;
        res.headers = {};
        if (callback) callback(res);
        res.emit("end");
      }
    };
    if (isMe) setTimeout(respond, ME_DELAY_MS);
    else setImmediate(respond);
  };
  return req;
}

vi.mock("node:https", () => ({
  default: { request: delayedHttpsRequest },
  request: delayedHttpsRequest,
}));

import type { Tool } from "@leadbay/core";
import { LeadbayClient } from "@leadbay/core";
import { buildServer } from "../src/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const BASE = "https://api-us.leadbay.app";

const pingTool: Tool = {
  name: "leadbay_ping_test",
  description: "test-only ping",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  outputSchema: {
    type: "object",
    properties: { pong: { type: "boolean" } },
    required: ["pong"],
  },
  annotations: { readOnlyHint: true },
  execute: async () => ({ pong: true }),
};

async function connect(token: string) {
  const lbClient = new LeadbayClient(BASE, token);
  const server = buildServer(lbClient, {
    includeWrite: true,
    version: "0.0.0-test",
    extraTools: [pingTool],
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test", version: "0.0.1" }, {});
  await Promise.all([
    server.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);
  return { mcpClient };
}

describe("intro surfacing — bounded /me wait (product#3829 review)", () => {
  it(
    "returns the tool result WITHOUT _meta.intro when /me is slower than the wait bound",
    async () => {
      const { mcpClient } = await connect("u.test-token");

      const started = Date.now();
      const result = await mcpClient.callTool({ name: "leadbay_ping_test", arguments: {} });
      const elapsed = Date.now() - started;

      // The tool succeeds and is NOT blocked on the hung /me.
      expect(result.isError).toBeFalsy();
      const structured = result.structuredContent as any;
      expect(structured.pong).toBe(true);
      // Intro is skipped this call — the slow /me never blocked the response.
      expect(structured._meta?.intro).toBeUndefined();
      // Returned well before /me would have resolved (bounded, not blocked).
      expect(elapsed).toBeLessThan(ME_DELAY_MS);
    },
    ME_DELAY_MS + 2000
  );
});
