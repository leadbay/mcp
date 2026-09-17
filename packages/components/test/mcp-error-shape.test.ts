import { describe, it, expect, beforeEach, vi } from "vitest";
import { lb } from "../src/runtime.js";

// The `mcp` capability (window.claude.use("mcp")) rejects callTool with a
// PLAIN OBJECT — `{code, message, server, retryable}` — not an Error instance.
// The old messageOf() did `String(e)` on any non-Error, which rendered every
// connector failure as the literal "[object Object]" and dropped the `code`.
// The code is the only field that distinguishes "reconnect the connector" from
// "wait and retry", so losing it turns a recoverable state into a dead end.
//
// These lock the unwrapping for any thenable that rejects with such an object,
// which is what an artifact's lb.configure({call}) adapter forwards.

function rejectWith(value: unknown) {
  return () => Promise.reject(value);
}

describe("plain-object rejections (the mcp capability's McpError)", () => {
  beforeEach(() => {
    lb.configure({ call: undefined, timeoutMs: 1000 });
  });

  it("keeps the message instead of stringifying to [object Object]", async () => {
    lb.configure({
      call: rejectWith({
        code: "server_not_connected",
        message: "No connector named Leadbay for this viewer",
      }),
    });
    const action = lb.action({ tool: "leadbay_like_lead", args: { lead_id: "x" } });
    await action.run();

    expect(action.error).not.toBeNull();
    expect(action.error?.message).toBe("No connector named Leadbay for this viewer");
    expect(action.error?.message).not.toContain("[object Object]");
  });

  it("carries the error code through to the view-model", async () => {
    lb.configure({
      call: rejectWith({ code: "needs_reauth", message: "token expired" }),
    });
    const action = lb.action({ tool: "leadbay_like_lead", args: { lead_id: "x" } });
    await action.run();

    expect(action.error?.code).toBe("needs_reauth");
  });

  it("does not mark a connector error as `unavailable` (that means no bridge)", async () => {
    lb.configure({
      call: rejectWith({ code: "rate_limited", message: "slow down" }),
    });
    const action = lb.action({ tool: "leadbay_like_lead", args: { lead_id: "x" } });
    await action.run();

    expect(action.error?.unavailable).toBe(false);
    expect(action.error?.code).toBe("rate_limited");
  });

  it("falls back to JSON when the object carries no message", async () => {
    lb.configure({ call: rejectWith({ code: "upstream_error" }) });
    const action = lb.action({ tool: "leadbay_like_lead", args: { lead_id: "x" } });
    await action.run();

    expect(action.error?.message).toContain("upstream_error");
    expect(action.error?.message).not.toContain("[object Object]");
  });

  it("still handles a real Error unchanged", async () => {
    lb.configure({ call: rejectWith(new Error("boom")) });
    const action = lb.action({ tool: "leadbay_like_lead", args: { lead_id: "x" } });
    await action.run();

    expect(action.error?.message).toBe("boom");
    expect(action.error?.code).toBeUndefined();
  });

  it("survives a circular object without throwing", async () => {
    const circular: Record<string, unknown> = { code: "upstream_error" };
    circular.self = circular;
    lb.configure({ call: rejectWith(circular) });
    const action = lb.action({ tool: "leadbay_like_lead", args: { lead_id: "x" } });
    await action.run();

    expect(action.error?.code).toBe("upstream_error");
    expect(typeof action.error?.message).toBe("string");
  });
});
