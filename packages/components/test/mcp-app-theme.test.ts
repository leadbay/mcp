import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { STYLES } from "../src/styles.js";
import { createMcpAppTransport, MCP_APP_PROTOCOL_VERSION } from "../src/mcp-app-bridge.js";
import { ARTIFACT_USAGE_GUIDE as GUIDE } from "../../core/src/artifact-runtime.generated.js";

// Seen in ChatGPT: the host marks the board's frame dark, the cards follow the
// skin into dark mode, and the page ground stayed #f0f0f0 — so "Today's leads"
// and its subtitle read white on light grey. The ground was the one colour the
// triage board took from the raw grey ramp instead of a themed token.

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, "../src/templates/triage-board/page.html"), "utf8");

/** The value of `name` in the block that starts at `selector`. */
function declared(selector: string, name: string): string | null {
  const start = STYLES.indexOf(selector);
  if (start < 0) return null;
  const end = STYLES.indexOf("\n}", start);
  const m = STYLES.slice(start, end).match(new RegExp(`\\${name}\\s*:\\s*([^;]+);`));
  return m ? m[1].trim() : null;
}

const hexLum = (h: string) => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
};
const contrast = (a: string, b: string) => {
  const [x, y] = [hexLum(a), hexLum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

describe("the page ground themes with the cards", () => {
  it("the skin declares --lb-page-bg in light and in BOTH dark blocks", () => {
    expect(declared(":root{", "--lb-page-bg")).toBe("var(--color-gray-2)");
    expect(declared(":root[data-theme=dark]", "--lb-page-bg")).toBe("#161616");
    expect(declared("@media(prefers-color-scheme:dark)", "--lb-page-bg")).toBe("#161616");
  });

  it("dark text reads on the dark ground, and cards still lift off it", () => {
    // --lb-fg is white in dark; --lb-surface is gray-9 (#202020).
    expect(contrast("#ffffff", "#161616")).toBeGreaterThanOrEqual(7);
    expect(contrast("#202020", "#161616")).toBeGreaterThan(1.05);
  });

  it("the triage board paints its body with the token, not a raw grey", () => {
    const body = page.match(/body\s*\{[^}]*\}/)![0];
    expect(body).toContain("background: var(--lb-page-bg)");
    expect(body).not.toMatch(/--color-gray-\d/);
  });

  it("the guide tells every agent-built board the same", () => {
    const flat = GUIDE.replace(/\s+/g, " ");
    expect(flat).toContain("`var(--lb-page-bg)`");
    expect(flat).toMatch(/A HOST's `data-theme="dark"`[^.]*is not guarded and wins/);
  });
});

describe("the MCP Apps transport follows the host's theme", () => {
  type Msg = Record<string, any>;
  let sent: Msg[];
  let self: EventTarget;
  const parent = { postMessage: (m: unknown) => sent.push(m as Msg) };
  const deliver = (data: unknown) =>
    self.dispatchEvent(Object.assign(new Event("message"), { data, source: parent }));

  beforeEach(() => {
    sent = [];
    self = new EventTarget();
    document.documentElement.removeAttribute("data-theme");
  });

  async function connectWith(hostContext: Record<string, unknown>) {
    const callTool = createMcpAppTransport("1", { parent, self });
    const p = callTool("leadbay_pull_leads", {});
    await vi.waitFor(() => expect(sent.some((m) => m.method === "ui/initialize")).toBe(true));
    const init = sent.find((m) => m.method === "ui/initialize")!;
    deliver({
      jsonrpc: "2.0",
      id: init.id,
      result: { protocolVersion: MCP_APP_PROTOCOL_VERSION, hostInfo: { name: "h", version: "1" }, hostCapabilities: {}, hostContext },
    });
    await vi.waitFor(() => expect(sent.some((m) => m.method === "tools/call")).toBe(true));
    deliver({ jsonrpc: "2.0", id: sent.find((m) => m.method === "tools/call")!.id, result: {} });
    await p;
  }

  it("applies the theme the host reports on connect", async () => {
    await connectWith({ theme: "dark" });
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("follows a theme toggle in the host", async () => {
    await connectWith({ theme: "dark" });
    deliver({ jsonrpc: "2.0", method: "ui/notifications/host-context-changed", params: { theme: "light" } });
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("leaves the page alone when the host reports no theme, or an unknown one", async () => {
    await connectWith({});
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    deliver({ jsonrpc: "2.0", method: "ui/notifications/host-context-changed", params: { theme: "sepia" } });
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
});
