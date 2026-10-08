// The kit's third transport: the page runs as an MCP App view (SEP-1865,
// https://github.com/modelcontextprotocol/ext-apps) inside a host such as
// ChatGPT. Unlike cowork and claude.ai, the host injects no global. The page
// talks JSON-RPC 2.0 to its parent window over postMessage:
//
//   view → host   ui/initialize            handshake, answered with host context
//   view → host   ui/notifications/initialized
//   view → host   tools/call               proxied by the host to OUR server
//   view → host   ui/open-link             a sandboxed frame cannot open tabs
//   view → host   ui/notifications/size-changed
//   host → view   ping, ui/resource-teardown   answered with {}
//   host → view   ui/notifications/host-context-changed   its `theme` is applied
//
// Hand-written rather than @modelcontextprotocol/ext-apps' `App` class: that
// class needs zod and the v2 MCP SDK, and this runtime is zero-dependency and
// inlined into every artifact. The spec itself says no SDK is needed.

export type CallFn = (tool: string, args: Record<string, unknown>) => Promise<unknown>;

export const MCP_APP_PROTOCOL_VERSION = "2026-01-26";

// A frame whose parent never answers is not an MCP App host (or not one that
// speaks this protocol). Fail fast with `unavailable`, well inside the 30s
// per-call timeout, so the board shows its error instead of a long spinner.
const HANDSHAKE_TIMEOUT_MS = 5_000;

/** The two windows the transport talks between. Injectable for tests. */
export interface McpAppEnv {
  parent: { postMessage(message: unknown, targetOrigin: string): void };
  self: Pick<Window, "addEventListener">;
}

interface Pending {
  resolve(value: unknown): void;
  reject(err: unknown): void;
}

/** Errors carry a `code` the runtime's codeOf()/errState() read, so a failed
 *  handshake surfaces as `unavailable` exactly like the other two transports. */
function fail(message: string, code: string): Error {
  return Object.assign(new Error(message), { name: "LbError", code });
}

/** True when the page sits in a frame, which is the only place an MCP App
 *  view can run. Checked AFTER cowork and claude.ai, which do inject globals. */
export function inFrame(): boolean {
  return typeof window !== "undefined" && window.parent != null && window.parent !== window;
}

export function createMcpAppTransport(
  appVersion: string,
  env: McpAppEnv = { parent: window.parent, self: window },
): CallFn {
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let session: Promise<void> | null = null;

  const post = (message: Record<string, unknown>) =>
    env.parent.postMessage({ jsonrpc: "2.0", ...message }, "*");

  function request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      post({ id, method, params });
    });
  }

  function onMessage(ev: MessageEvent): void {
    // Only the host may answer. A sandboxed view has no other legitimate sender.
    if (ev.source !== env.parent) return;
    const m = ev.data as Record<string, any> | null;
    if (!m || typeof m !== "object" || m.jsonrpc !== "2.0") return;

    if (typeof m.method === "string") {
      // Host notifications need no answer. The board loads its own data through
      // tools/call, so tool-input / tool-result change nothing. A theme toggle
      // in the host does: follow it, like the initialize answer below.
      if (m.id === undefined) {
        if (m.method === "ui/notifications/host-context-changed") applyHostTheme(m.params?.theme);
        return;
      }
      if (m.method === "ping" || m.method === "ui/resource-teardown") {
        post({ id: m.id, result: {} });
      } else {
        post({ id: m.id, error: { code: -32601, message: `Method not found: ${m.method}` } });
      }
      return;
    }

    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.error) p.reject(fail(String(m.error.message || "The host refused the call"), "host_error"));
    else p.resolve(m.result);
  }

  function connect(): Promise<void> {
    if (!session) {
      session = (async () => {
        env.self.addEventListener("message", onMessage as EventListener);
        const id = nextId;
        const init = request("ui/initialize", {
          appInfo: { name: "Leadbay", version: appVersion },
          appCapabilities: {},
          protocolVersion: MCP_APP_PROTOCOL_VERSION,
        });
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            pending.delete(id);
            reject(
              fail(
                "Leadbay is not reachable from this page — the host never answered the MCP Apps handshake.",
                "unavailable",
              ),
            );
          }, HANDSHAKE_TIMEOUT_MS);
        });
        let result: unknown;
        try {
          result = await Promise.race([init, timeout]);
        } finally {
          if (timer) clearTimeout(timer);
        }
        applyHostTheme((result as { hostContext?: { theme?: unknown } } | undefined)?.hostContext?.theme);
        post({ method: "ui/notifications/initialized", params: {} });
        reportSize(post);
        routeLinksThroughHost(request);
      })();
      // A failed handshake must not poison every later call: let the next one retry.
      session.catch(() => {
        session = null;
      });
    }
    return session;
  }

  return async (tool, args) => {
    await connect();
    // The CallToolResult comes back as is; the runtime's normalize() reads
    // structuredContent / isError off it, as it does for the other transports.
    return request("tools/call", { name: tool, arguments: args });
  };
}

// Follow the host's light / dark theme. The skin themes on `data-theme` on
// <html> (styles.ts), and that hook wins over a board's own light pin
// (`data-lb-theme="light"`) — which is the point: the board sits INSIDE the
// host's chat, so a light board in a dark thread is the bright rectangle
// CLAUDE.md warns about. Some hosts set the attribute themselves (ChatGPT
// does); this covers the ones that only report it, and theme toggles.
function applyHostTheme(theme: unknown): void {
  if (typeof document === "undefined") return;
  if (theme !== "light" && theme !== "dark") return;
  document.documentElement.setAttribute("data-theme", theme);
}

// The host sizes the frame from these reports; without them an inline view is
// clipped to whatever height the host guessed. Same measurement as ext-apps'
// App.setupSizeChangedNotifications: max-content height, so content taller than
// the frame grows the frame instead of scrolling inside it.
function reportSize(post: (m: Record<string, unknown>) => void): void {
  if (typeof document === "undefined" || typeof ResizeObserver === "undefined") return;
  let scheduled = false;
  let lastWidth = 0;
  let lastHeight = 0;
  const send = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const html = document.documentElement;
      const original = html.style.height;
      html.style.height = "max-content";
      const height = Math.ceil(html.getBoundingClientRect().height);
      html.style.height = original;
      const width = Math.ceil(window.innerWidth);
      if (width === lastWidth && height === lastHeight) return;
      lastWidth = width;
      lastHeight = height;
      post({ method: "ui/notifications/size-changed", params: { width, height } });
    });
  };
  send();
  const observer = new ResizeObserver(send);
  observer.observe(document.documentElement);
  observer.observe(document.body);
}

// A sandboxed frame usually may not open a tab, so `target="_blank"` links
// ("Open in Leadbay", the company website) would do nothing. Ask the host to
// open them; fall back to the browser if the host refuses.
function routeLinksThroughHost(
  request: (method: string, params: Record<string, unknown>) => Promise<unknown>,
): void {
  if (typeof document === "undefined") return;
  document.addEventListener(
    "click",
    (ev) => {
      const target = ev.target as Element | null;
      const a = target && typeof target.closest === "function" ? target.closest("a[href]") : null;
      if (!a) return;
      const url = (a as HTMLAnchorElement).href;
      if (!/^https?:\/\//i.test(url)) return;
      ev.preventDefault();
      request("ui/open-link", { url }).catch(() => {
        window.open(url, "_blank", "noopener");
      });
    },
    true,
  );
}
