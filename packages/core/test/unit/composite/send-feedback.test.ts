import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory, getHttpRequests } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { sendFeedback } from "../../../src/composite/send-feedback.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

describe("leadbay_send_feedback", () => {
  it("happy path — calls ctx.sendFeedback with the message and reports sent", async () => {
    mockHttp([]);
    const calls: Array<{ message: string; opts?: any }> = [];
    const ctx = {
      sendFeedback: (message: string, opts?: any) => {
        calls.push({ message, opts });
        return true;
      },
    };
    const res: any = await sendFeedback.execute(
      newClient(),
      { message: "  lead scores feel off this week  " },
      ctx
    );
    expect(res.sent).toBe(true);
    expect(calls).toHaveLength(1);
    // Trimmed before sending.
    expect(calls[0].message).toBe("lead scores feel off this week");
    // No HTTP call — feedback goes via the telemetry transport, not the API.
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("passes associated_error_id through as associatedEventId", async () => {
    mockHttp([]);
    let seenOpts: any;
    const ctx = {
      sendFeedback: (_m: string, opts?: any) => {
        seenOpts = opts;
        return true;
      },
    };
    await sendFeedback.execute(
      newClient(),
      { message: "this errored", associated_error_id: "evt_123" },
      ctx
    );
    expect(seenOpts).toEqual({ associatedEventId: "evt_123" });
  });

  it("empty message — BAD_INPUT, never calls sendFeedback", async () => {
    mockHttp([]);
    let called = false;
    const ctx = { sendFeedback: () => ((called = true), true) };
    const res: any = await sendFeedback.execute(newClient(), { message: "   " }, ctx);
    expect(res.error).toBe(true);
    expect(res.code).toBe("BAD_INPUT");
    expect(called).toBe(false);
  });

  it("no transport wired (ctx.sendFeedback undefined) — reports sent:false, no false success", async () => {
    mockHttp([]);
    const res: any = await sendFeedback.execute(
      newClient(),
      { message: "anything" },
      {}
    );
    expect(res.sent).toBe(false);
    expect(res.message.toLowerCase()).toContain("could not");
  });

  it("transport returns false (Sentry not ready) — sent:false", async () => {
    mockHttp([]);
    const ctx = { sendFeedback: () => false };
    const res: any = await sendFeedback.execute(newClient(), { message: "hi" }, ctx);
    expect(res.sent).toBe(false);
  });
});
