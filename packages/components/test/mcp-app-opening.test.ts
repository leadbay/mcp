import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createMcpAppTransport, MCP_APP_PROTOCOL_VERSION } from "../src/mcp-app-bridge.js";
import { configure, openingResult, locale, i18n, lb } from "../src/runtime.js";

// Load once, frame size, and the viewer's language — what an MCP Apps host
// tells a board beyond tool results.
//
// Load once: the host sends the tool call that OPENED the view
// (ui/notifications/tool-input + tool-result). A board that ignored it pulled
// the same leads again — a second call, and a second "seen" receipt.

type Msg = Record<string, any>;

function fakeHost(hostContext: Record<string, unknown> = {}) {
  const sent: Msg[] = [];
  const parent = { postMessage: (m: unknown) => sent.push(m as Msg) };
  const self = new EventTarget();
  const deliver = (data: unknown) => self.dispatchEvent(Object.assign(new Event("message"), { data, source: parent }));
  const notify = (method: string, params: unknown) => deliver({ jsonrpc: "2.0", method, params });
  const handshake = async () => {
    await vi.waitFor(() => expect(sent.some((m) => m.method === "ui/initialize")).toBe(true));
    const init = sent.find((m) => m.method === "ui/initialize")!;
    deliver({ jsonrpc: "2.0", id: init.id, result: { protocolVersion: MCP_APP_PROTOCOL_VERSION, hostInfo: { name: "h", version: "1" }, hostCapabilities: {}, hostContext } });
  };
  return { sent, parent, self, notify, handshake };
}

beforeEach(() => {
  document.documentElement.removeAttribute("data-lb-surface");
  document.documentElement.style.removeProperty("--lb-frame-height");
  document.documentElement.style.removeProperty("--lb-frame-max-height");
});

describe("the opening call", () => {
  it("is handed over once the host sends its result", async () => {
    const host = fakeHost();
    const tr = createMcpAppTransport("1", host);
    const p = tr.opening(1000);
    await host.handshake();
    host.notify("ui/notifications/tool-input", { arguments: { count: 25, lensId: "L9" } });
    host.notify("ui/notifications/tool-result", { structuredContent: { leads: [{ id: "a" }] } });
    expect(await p).toEqual({ args: { count: 25, lensId: "L9" }, result: { structuredContent: { leads: [{ id: "a" }] } } });
  });

  it("keeps the FIRST result — a later call the view makes did not open it", async () => {
    const host = fakeHost();
    const tr = createMcpAppTransport("1", host);
    const p = tr.opening(1000);
    await host.handshake();
    host.notify("ui/notifications/tool-result", { structuredContent: { opening: true } });
    host.notify("ui/notifications/tool-result", { structuredContent: { later: true } });
    expect((await p)!.result).toEqual({ structuredContent: { opening: true } });
  });

  it("is null when the host cancels the call, or never sends a result", async () => {
    const cancelled = fakeHost();
    const a = createMcpAppTransport("1", cancelled).opening(1000);
    await cancelled.handshake();
    cancelled.notify("ui/notifications/tool-cancelled", { reason: "user" });
    expect(await a).toBeNull();

    const silent = fakeHost();
    const b = createMcpAppTransport("1", silent).opening(30);
    await silent.handshake();
    expect(await b).toBeNull();
  });
});

describe("the frame", () => {
  it("marks the page as an MCP Apps view and passes the host's height limits", async () => {
    const host = fakeHost({ containerDimensions: { width: 700, maxHeight: 600 } });
    const call = createMcpAppTransport("1", host);
    call("leadbay_pull_leads", {}).catch(() => {});
    await host.handshake();
    await vi.waitFor(() => expect(document.documentElement.getAttribute("data-lb-surface")).toBe("mcp-app"));
    expect(document.documentElement.style.getPropertyValue("--lb-frame-max-height")).toBe("600px");
    expect(document.documentElement.style.getPropertyValue("--lb-frame-height")).toBe("");
    host.notify("ui/notifications/host-context-changed", { containerDimensions: { height: 480 } });
    expect(document.documentElement.style.getPropertyValue("--lb-frame-height")).toBe("480px");
    expect(document.documentElement.style.getPropertyValue("--lb-frame-max-height")).toBe("");
  });
});

describe("lb.openingResult outside an MCP Apps view", () => {
  afterEach(() => {
    configure({});
    delete (globalThis as any).cowork;
  });

  it("is null at once on cowork, so the board loads its own data", async () => {
    (globalThis as any).cowork = { callMcpTool: async () => ({}) };
    expect(await openingResult()).toBeNull();
  });

  it("is null when a transport was configured (claude.ai's page-level bridge)", async () => {
    configure({ call: async () => ({}) });
    expect(await openingResult()).toBeNull();
  });
});

describe("lb.openingResult inside an MCP Apps view", () => {
  const realParent = Object.getOwnPropertyDescriptor(window, "parent");
  afterEach(() => {
    if (realParent) Object.defineProperty(window, "parent", realParent);
    configure({});
  });

  function frameWithHost(result: unknown, args: unknown = { count: 25 }, hostContext: Record<string, unknown> = {}) {
    const sent: Msg[] = [];
    const parent = {
      postMessage(m: Msg) {
        sent.push(m);
        const reply = (data: unknown) =>
          queueMicrotask(() => window.dispatchEvent(Object.assign(new Event("message"), { data, source: parent })));
        if (m.method === "ui/initialize") {
          reply({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: MCP_APP_PROTOCOL_VERSION, hostInfo: {}, hostCapabilities: {}, hostContext } });
        }
        if (m.method === "ui/notifications/initialized") {
          reply({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: args } });
          reply({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: result });
        }
      },
    };
    Object.defineProperty(window, "parent", { value: parent, configurable: true });
    configure({});
    return sent;
  }

  it("returns the normalized result and the agent's arguments, with no tool call", async () => {
    const sent = frameWithHost({ structuredContent: { leads: [{ id: "a" }], pagination: { total: 40 } } });
    const o = await openingResult({ timeoutMs: 2000 });
    expect(o).toEqual({ args: { count: 25 }, result: { leads: [{ id: "a" }], pagination: { total: 40 } } });
    expect(sent.some((m) => m.method === "tools/call")).toBe(false);
  });

  it("is null for an error result, so the board's own call surfaces the error", async () => {
    frameWithHost({ isError: true, content: [{ type: "text", text: "QUOTA_EXCEEDED" }] });
    expect(await openingResult({ timeoutMs: 2000 })).toBeNull();
  });

  it("the host's locale decides the language once the handshake reported it", async () => {
    frameWithHost({ structuredContent: {} }, {}, { locale: "fr-FR" });
    await openingResult({ timeoutMs: 2000 });
    expect(locale()).toBe("fr");
  });
});

describe("lb.locale / lb.i18n", () => {
  const nav = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(navigator), "languages");
  afterEach(() => {
    if (nav) Object.defineProperty(navigator, "languages", nav);
    configure({});
  });
  const setLang = (lang: string) => Object.defineProperty(navigator, "languages", { value: [lang], configurable: true });

  it("follows the browser when no host reports a locale", () => {
    configure({});
    setLang("fr-BE");
    expect(locale()).toBe("fr");
    setLang("en-GB");
    expect(locale()).toBe("en");
    setLang("de-DE");
    expect(locale()).toBe("en"); // English is the fallback language
  });

  it("t() picks the language, falls back to English per key, and fills placeholders", () => {
    configure({});
    const t = i18n({ en: { hi: "Hello {name}", only: "English only" }, fr: { hi: "Bonjour {name}" } });
    setLang("fr-FR");
    expect(t("hi", { name: "Ana" })).toBe("Bonjour Ana");
    expect(t("only")).toBe("English only");
    setLang("en-US");
    expect(t("hi", { name: "Ana" })).toBe("Hello Ana");
  });

  it("the kit's status picker speaks French to a French viewer", async () => {
    configure({});
    setLang("fr-FR");
    const field = lb.leadStatus("");
    await vi.waitFor(() => expect(field.options.length).toBeGreaterThan(0));
    expect(field.options.map((o: { label: string }) => o.label)).toEqual(["Choisir un statut", "En cours", "Gagné", "Perdu", "Non souhaité"]);
  });
});
