import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { sendFeedback } from "../../../src/tools/send-feedback.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

describe("leadbay_send_feedback — input hardening", () => {
  it("forwards a well-formed Sentry event id (32 hex) as associatedEventId", async () => {
    mockHttp([]);
    let seenOpts: any;
    const ctx = { sendFeedback: (_m: string, opts?: any) => ((seenOpts = opts), true) };
    const id = "abcdef0123456789abcdef0123456789";
    await sendFeedback.execute(newClient(), { message: "hi", associated_error_id: id }, ctx);
    expect(seenOpts).toEqual({ associatedEventId: id });
  });

  it("drops a malformed associated_error_id rather than forwarding it", async () => {
    mockHttp([]);
    let seenOpts: any;
    const ctx = { sendFeedback: (_m: string, opts?: any) => ((seenOpts = opts), true) };
    await sendFeedback.execute(
      newClient(),
      { message: "hi", associated_error_id: "not-a-real-id; drop tables" },
      ctx
    );
    // Malformed id is dropped — no associatedEventId reaches the transport.
    expect(seenOpts).toEqual({});
  });

  it("truncates to the advertised cap (<= 4000 chars incl. ellipsis)", async () => {
    mockHttp([]);
    let seenMsg = "";
    const ctx = { sendFeedback: (m: string) => ((seenMsg = m), true) };
    const long = "x".repeat(5000);
    await sendFeedback.execute(newClient(), { message: long }, ctx);
    expect(seenMsg.length).toBe(4000); // 3999 chars + the "…"
    expect(seenMsg.endsWith("…")).toBe(true);
  });

  it("leaves a message at/under the cap untouched (no ellipsis)", async () => {
    mockHttp([]);
    let seenMsg = "";
    const ctx = { sendFeedback: (m: string) => ((seenMsg = m), true) };
    const exact = "y".repeat(4000);
    await sendFeedback.execute(newClient(), { message: exact }, ctx);
    expect(seenMsg).toBe(exact);
    expect(seenMsg.endsWith("…")).toBe(false);
  });
});
