import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createMcpAppTransport, MCP_APP_PROTOCOL_VERSION } from "../src/mcp-app-bridge.js";
import { configure, call } from "../src/runtime.js";

// The kit's third transport. Served from /chatgpt/mcp and /apps/mcp, the
// finished boards run as MCP App views: no window.cowork, no window.claude,
// just a frame that speaks JSON-RPC to its parent over postMessage. Without
// this transport the board showed "bridge unavailable" on every non-Claude host.

type Msg = Record<string, any>;

function fakeHost() {
  const sent: Msg[] = [];
  const parent = { postMessage: (m: unknown) => sent.push(m as Msg) };
  const self = new EventTarget();
  const deliver = (data: unknown, source: unknown = parent) =>
    self.dispatchEvent(Object.assign(new Event("message"), { data, source }));
  const answer = (method: string, result: unknown) => {
    const req = sent.find((m) => m.method === method && m.id !== undefined && !m.answered);
    if (!req) throw new Error(`no pending ${method}`);
    req.answered = true;
    deliver({ jsonrpc: "2.0", id: req.id, result });
  };
  const waitFor = (method: string) =>
    vi.waitFor(() => {
      if (!sent.some((m) => m.method === method && !m.answered)) throw new Error(`waiting for ${method}`);
    });
  return { sent, parent, self, deliver, answer, waitFor };
}

const HOST_INIT = { protocolVersion: MCP_APP_PROTOCOL_VERSION, hostInfo: { name: "test-host", version: "1" }, hostCapabilities: {}, hostContext: {} };

describe("the MCP Apps transport", () => {
  it("handshakes once, then proxies the tool call to the host", async () => {
    const host = fakeHost();
    const callTool = createMcpAppTransport("9.9.9", host);

    const p = callTool("leadbay_pull_leads", { count: 10 });
    await host.waitFor("ui/initialize");
    const init = host.sent.find((m) => m.method === "ui/initialize")!;
    expect(init.jsonrpc).toBe("2.0");
    expect(init.params).toEqual({
      appInfo: { name: "Leadbay", version: "9.9.9" },
      appCapabilities: {},
      protocolVersion: MCP_APP_PROTOCOL_VERSION,
    });
    host.answer("ui/initialize", HOST_INIT);

    await host.waitFor("tools/call");
    // initialized goes out after the handshake answer and before any call.
    const order = host.sent.map((m) => m.method);
    expect(order.indexOf("ui/notifications/initialized")).toBeGreaterThan(order.indexOf("ui/initialize"));
    expect(order.indexOf("ui/notifications/initialized")).toBeLessThan(order.indexOf("tools/call"));

    const tc = host.sent.find((m) => m.method === "tools/call")!;
    expect(tc.params).toEqual({ name: "leadbay_pull_leads", arguments: { count: 10 } });
    host.answer("tools/call", { structuredContent: { leads: [] } });
    expect(await p).toEqual({ structuredContent: { leads: [] } });

    // A second call reuses the session: no second handshake.
    const p2 = callTool("leadbay_like_lead", { leadId: "L1" });
    await host.waitFor("tools/call");
    host.answer("tools/call", { content: [] });
    await p2;
    expect(host.sent.filter((m) => m.method === "ui/initialize")).toHaveLength(1);
  });

  it("ignores messages that do not come from the parent window", async () => {
    const host = fakeHost();
    const callTool = createMcpAppTransport("1", host);
    let settled = false;
    callTool("leadbay_pull_leads", {}).then(() => (settled = true), () => (settled = true));
    await host.waitFor("ui/initialize");
    const id = host.sent.find((m) => m.method === "ui/initialize")!.id;
    host.deliver({ jsonrpc: "2.0", id, result: HOST_INIT }, { postMessage() {} });
    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);
    expect(host.sent.some((m) => m.method === "tools/call")).toBe(false);
  });

  it("a host error rejects the call with the host's message", async () => {
    const host = fakeHost();
    const callTool = createMcpAppTransport("1", host);
    const p = callTool("leadbay_like_lead", { leadId: "L1" });
    await host.waitFor("ui/initialize");
    host.answer("ui/initialize", HOST_INIT);
    await host.waitFor("tools/call");
    const id = host.sent.find((m) => m.method === "tools/call")!.id;
    host.deliver({ jsonrpc: "2.0", id, error: { code: -32000, message: "Tool not allowed" } });
    await expect(p).rejects.toMatchObject({ message: "Tool not allowed", code: "host_error" });
  });

  it("a parent that never answers fails as `unavailable`, and a later call retries", async () => {
    vi.useFakeTimers();
    try {
      const host = fakeHost();
      const callTool = createMcpAppTransport("1", host);
      const p = callTool("leadbay_pull_leads", {});
      const assertion = expect(p).rejects.toMatchObject({ code: "unavailable" });
      await vi.advanceTimersByTimeAsync(5_000);
      await assertion;

      callTool("leadbay_pull_leads", {}).catch(() => {});
      await vi.advanceTimersByTimeAsync(0);
      expect(host.sent.filter((m) => m.method === "ui/initialize")).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers the host's ping and teardown, and refuses what it does not implement", async () => {
    const host = fakeHost();
    const callTool = createMcpAppTransport("1", host);
    callTool("leadbay_pull_leads", {}).catch(() => {});
    await host.waitFor("ui/initialize");
    host.deliver({ jsonrpc: "2.0", id: "p1", method: "ping" });
    host.deliver({ jsonrpc: "2.0", id: "t1", method: "ui/resource-teardown", params: { reason: "x" } });
    host.deliver({ jsonrpc: "2.0", id: "u1", method: "tools/list" });
    expect(host.sent.find((m) => m.id === "p1")).toMatchObject({ result: {} });
    expect(host.sent.find((m) => m.id === "t1")).toMatchObject({ result: {} });
    expect(host.sent.find((m) => m.id === "u1")?.error?.code).toBe(-32601);
  });

  it("routes an external link click through ui/open-link", async () => {
    const host = fakeHost();
    const callTool = createMcpAppTransport("1", host);
    const p = callTool("leadbay_pull_leads", {});
    await host.waitFor("ui/initialize");
    host.answer("ui/initialize", HOST_INIT);
    await host.waitFor("tools/call");
    host.answer("tools/call", {});
    await p;

    const a = document.createElement("a");
    a.href = "https://leadbay.app/app/discover?lead=L1";
    a.target = "_blank";
    a.textContent = "Open in Leadbay";
    document.body.append(a);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    a.dispatchEvent(click);
    a.remove();

    expect(click.defaultPrevented).toBe(true);
    const open = host.sent.find((m) => m.method === "ui/open-link");
    expect(open?.params).toEqual({ url: "https://leadbay.app/app/discover?lead=L1" });
  });
});

describe("the runtime picks the transport inside a frame", () => {
  const realParent = Object.getOwnPropertyDescriptor(window, "parent");

  beforeEach(() => {
    configure({});
    delete (globalThis as any).cowork;
    delete (globalThis as any).claude;
  });
  afterEach(() => {
    if (realParent) Object.defineProperty(window, "parent", realParent);
    configure({});
  });

  it("a framed page with no cowork or claude global talks MCP Apps, and normalize() unwraps the result", async () => {
    const sent: Msg[] = [];
    const parent = {
      postMessage(m: Msg) {
        sent.push(m);
        const reply =
          m.method === "ui/initialize" ? HOST_INIT
          : m.method === "tools/call" ? { structuredContent: { pagination: { total: 42 } } }
          : undefined;
        if (reply && m.id !== undefined) {
          queueMicrotask(() =>
            window.dispatchEvent(Object.assign(new Event("message"), { data: { jsonrpc: "2.0", id: m.id, result: reply }, source: parent })),
          );
        }
      },
    };
    Object.defineProperty(window, "parent", { value: parent, configurable: true });

    const r = (await call("leadbay_pull_leads", { count: 1 })) as any;
    expect(r.pagination.total).toBe(42);
    expect(sent.map((m) => m.method)).toContain("tools/call");
  });

  it("cowork still wins inside a frame", async () => {
    Object.defineProperty(window, "parent", { value: { postMessage() {} }, configurable: true });
    (globalThis as any).cowork = { callMcpTool: async () => ({ via: "cowork" }) };
    try {
      expect(((await call("leadbay_pull_leads", {})) as any).via).toBe("cowork");
    } finally {
      delete (globalThis as any).cowork;
    }
  });
});
