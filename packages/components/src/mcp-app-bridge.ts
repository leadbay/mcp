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
//   host → view   ui/notifications/host-context-changed   theme / size / locale kept
//   host → view   ui/notifications/tool-input, tool-result   the call that opened
//                 this view — a board renders from it instead of calling again
//
// After the handshake the page is marked `data-lb-surface="mcp-app"`, and the
// host's frame limits land as `--lb-frame-height` / `--lb-frame-max-height`,
// so a board that fills its window (the route planner) can size itself to the
// frame instead of collapsing in it.
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

/** The tool call whose result opened this view, as the host reported it. */
export interface McpAppOpening {
  args: Record<string, unknown> | null;
  /** The raw CallToolResult. */
  result: unknown;
}

/** A tool-calling function, plus what the host told the view about itself. */
export type McpAppTransport = CallFn & {
  /** The opening call, once the host has sent its result — or null if it was
   *  cancelled or did not arrive within `timeoutMs`. */
  opening(timeoutMs?: number): Promise<McpAppOpening | null>;
  /** The host context so far (theme, locale, containerDimensions, …). */
  hostContext(): Record<string, any>;
};

// The opening result may still be computing when the view appears — a host
// MAY show the view during tool execution. Long enough for a slow pull, short
// enough that a host that never sends it still gets a board.
const OPENING_TIMEOUT_MS = 20_000;

export function createMcpAppTransport(
  appVersion: string,
  env: McpAppEnv = { parent: window.parent, self: window },
): McpAppTransport {
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let session: Promise<void> | null = null;
  let context: Record<string, any> = {};
  // Only the FIRST tool-input / tool-result: the host may also report calls
  // the view itself makes later, and those did not open it.
  let openingArgs: Record<string, unknown> | null | undefined;
  let openingResult: unknown;
  let openingDone = false;
  const openingWaiters = new Set<() => void>();
  const settleOpening = () => {
    openingDone = true;
    for (const w of openingWaiters) w();
    openingWaiters.clear();
  };

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
      // Host notifications need no answer.
      if (m.id === undefined) {
        if (m.method === "ui/notifications/host-context-changed") {
          // Partial updates: merge, then re-apply what the page follows.
          context = { ...context, ...(m.params ?? {}) };
          applyHostContext(context);
        } else if (m.method === "ui/notifications/tool-input" && openingArgs === undefined) {
          const a = m.params?.arguments;
          openingArgs = a && typeof a === "object" ? (a as Record<string, unknown>) : null;
        } else if (m.method === "ui/notifications/tool-result" && !openingDone) {
          openingResult = m.params;
          settleOpening();
        } else if (m.method === "ui/notifications/tool-cancelled" && !openingDone) {
          settleOpening();
        }
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
        const ctx = (result as { hostContext?: unknown } | undefined)?.hostContext;
        context = ctx && typeof ctx === "object" ? { ...(ctx as Record<string, any>) } : {};
        if (typeof document !== "undefined") {
          document.documentElement.setAttribute("data-lb-surface", "mcp-app");
        }
        applyHostContext(context);
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

  const call: CallFn = async (tool, args) => {
    await connect();
    // The CallToolResult comes back as is; the runtime's normalize() reads
    // structuredContent / isError off it, as it does for the other transports.
    return request("tools/call", { name: tool, arguments: args });
  };

  async function opening(timeoutMs: number = OPENING_TIMEOUT_MS): Promise<McpAppOpening | null> {
    await connect();
    if (!openingDone) {
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          openingWaiters.delete(done);
          resolve();
        };
        const timer = setTimeout(done, timeoutMs);
        openingWaiters.add(done);
      });
    }
    if (openingResult === undefined) return null;
    return { args: openingArgs ?? null, result: openingResult };
  }

  return Object.assign(call, { opening, hostContext: () => context });
}

/** Apply what the page follows from the host context: the theme, and the
 *  frame's height limits as CSS variables. */
function applyHostContext(ctx: Record<string, any>): void {
  applyHostTheme(ctx.theme);
  if (typeof document === "undefined") return;
  const root = document.documentElement.style;
  const dims = (ctx.containerDimensions ?? {}) as Record<string, unknown>;
  const px = (v: unknown) => (typeof v === "number" && v > 0 ? `${Math.floor(v)}px` : null);
  const fixed = px(dims.height);
  const max = px(dims.maxHeight);
  if (fixed) root.setProperty("--lb-frame-height", fixed);
  else root.removeProperty("--lb-frame-height");
  if (max) root.setProperty("--lb-frame-max-height", max);
  else root.removeProperty("--lb-frame-max-height");
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
