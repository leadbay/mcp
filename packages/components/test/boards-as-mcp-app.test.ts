import { describe, it, expect, vi } from "vitest";
import { JSDOM } from "jsdom";
import { ARTIFACT_TEMPLATES } from "../../core/src/artifact-templates.generated.js";

// The two finished boards, booted for real — as an MCP Apps view inside a
// fake host, and as a Claude artifact — to pin what each surface gets:
//
//   load once   the board renders the call that opened it; it does not pull
//               the same leads again, and "next page" continues that batch
//   French      labels follow the host's locale (MCP Apps) or the browser's
//   any host    the route planner no longer requires claude.ai's runtime

type Msg = Record<string, any>;

// Leaflet stand-in: every property and call returns the stub itself, numbers
// coerce to 0, and it is not a thenable. The planner only needs Leaflet not to
// throw; what is under test is its data flow and its labels.
function leafletStub(): any {
  const handler: ProxyHandler<any> = {
    get: (_t, p) => (p === Symbol.toPrimitive ? () => 0 : p === "then" ? undefined : stub),
    apply: () => stub,
    construct: () => stub,
  };
  const stub: any = new Proxy(function () {}, handler);
  return stub;
}

interface Boot {
  html: string;
  /** MCP Apps host: the opening call and the host context. */
  host?: { args?: Record<string, unknown>; result?: unknown; context?: Record<string, unknown> };
  /** Claude artifact surfaces instead of a host. */
  cowork?: boolean;
  claude?: boolean;
  lang?: string;
  /** Answer for a tools/call the page makes. */
  onTool?: (name: string, args: Record<string, unknown>) => unknown;
}

function boot(o: Boot) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const answer = (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    return (o.onTool && o.onTool(name, args)) ?? {};
  };
  let win: any;
  const parent = {
    postMessage(m: Msg) {
      const reply = (data: unknown) =>
        queueMicrotask(() => win.dispatchEvent(Object.assign(new win.Event("message"), { data, source: parent })));
      if (m.method === "ui/initialize") {
        reply({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2026-01-26", hostInfo: {}, hostCapabilities: {}, hostContext: o.host?.context ?? {} } });
      } else if (m.method === "ui/notifications/initialized") {
        reply({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: o.host?.args ?? {} } });
        if (o.host?.result !== undefined) reply({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: o.host.result });
      } else if (m.method === "tools/call") {
        reply({ jsonrpc: "2.0", id: m.id, result: { structuredContent: answer(m.params.name, m.params.arguments) } });
      }
    },
  };
  const dom = new JSDOM(o.html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(w: any) {
      win = w;
      w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
      w.L = leafletStub();
      if (o.lang) Object.defineProperty(w.navigator, "languages", { value: [o.lang], configurable: true });
      if (o.host) Object.defineProperty(w, "parent", { value: parent, configurable: true });
      if (o.cowork) w.cowork = { callMcpTool: async (name: string, args: any) => answer(name, args) };
      if (o.claude) {
        w.claude = {
          use: async () => ({ callTool: async (_s: string, name: string, args: any) => ({ payload: answer(name, args) }) }),
        };
      }
    },
  });
  return { dom, doc: dom.window.document as Document, calls };
}

const lead = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: `Company ${id}`, score: 70, ...extra })

describe("the triage board as an MCP Apps view", () => {
  const opening = {
    args: { count: 2 },
    result: { structuredContent: { leads: [lead("a"), lead("b")], pagination: { total: 4 }, lens: { id: "LENS-1" } } },
  };

  it("renders the call that opened it — no second pull_leads", async () => {
    const { doc, calls } = boot({ html: ARTIFACT_TEMPLATES.triage_board.html, host: opening });
    await vi.waitFor(() => expect(doc.querySelectorAll(".lb-card").length).toBe(2));
    expect(calls.filter((c) => c.name === "leadbay_pull_leads")).toHaveLength(0);
    expect(doc.getElementById("range")!.textContent).toBe("1–2 of 4");
  });

  it("next page continues the agent's batch: its page size, on the lens it came from", async () => {
    const { doc, calls } = boot({
      html: ARTIFACT_TEMPLATES.triage_board.html,
      host: opening,
      onTool: (name) => (name === "leadbay_pull_leads" ? { leads: [lead("c"), lead("d")], pagination: { total: 4 } } : {}),
    });
    await vi.waitFor(() => expect(doc.querySelectorAll(".lb-card").length).toBe(2));
    (doc.getElementById("next") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(calls.some((c) => c.name === "leadbay_pull_leads")).toBe(true));
    const pull = calls.find((c) => c.name === "leadbay_pull_leads")!;
    expect(pull.args).toMatchObject({ page: 1, count: 2, lensId: "LENS-1" });
  });

  it("labels itself in French when the host's locale is French", async () => {
    const { doc } = boot({ html: ARTIFACT_TEMPLATES.triage_board.html, host: { ...opening, context: { locale: "fr-FR" } } });
    await vi.waitFor(() => expect(doc.querySelectorAll(".lb-card").length).toBe(2));
    expect(doc.querySelector("h1")!.textContent).toBe("Leads du jour");
    expect(doc.getElementById("bulk-apply")!.textContent).toBe("Appliquer à la sélection");
    expect(doc.querySelector(".lb-btn-ai")!.textContent).toBe("Qualifier");
    const statuses = [...doc.querySelectorAll(".lb-card select option")].map((o) => o.textContent);
    expect(statuses).toContain("En cours");
  });
});

describe("the triage board as a Claude artifact", () => {
  it("still loads its own first page", async () => {
    const { doc, calls } = boot({
      html: ARTIFACT_TEMPLATES.triage_board.html,
      cowork: true,
      onTool: (name) => (name === "leadbay_pull_leads" ? { leads: [lead("a")], pagination: { total: 1 } } : {}),
    });
    await vi.waitFor(() => expect(doc.querySelectorAll(".lb-card").length).toBe(1));
    expect(calls.find((c) => c.name === "leadbay_pull_leads")!.args).toMatchObject({ page: 0, count: 10 });
  });

  it("labels itself in French for a French browser", async () => {
    const { doc } = boot({
      html: ARTIFACT_TEMPLATES.triage_board.html,
      cowork: true,
      lang: "fr-FR",
      onTool: (name) => (name === "leadbay_pull_leads" ? { leads: [lead("a")], pagination: { total: 1 } } : {}),
    });
    await vi.waitFor(() => expect(doc.querySelectorAll(".lb-card").length).toBe(1));
    expect(doc.querySelector("h1")!.textContent).toBe("Leads du jour");
    expect(doc.querySelector(".lb-sec-title")!.textContent).toBe("Adéquation");
  });
});

describe("the route planner", () => {
  const followups = { leads: [lead("x", { location: { city: "Lyon", pos: [45.76, 4.83] } })], pagination: { total: 1 }, _meta: { region: "fr" } };

  it("as an MCP Apps view: renders the opening call on the agent's city, sized for the frame", async () => {
    const { doc, calls } = boot({
      html: ARTIFACT_TEMPLATES.route_planner.html,
      host: { args: { city: "Lyon", count: 50 }, result: { structuredContent: followups } },
    });
    await vi.waitFor(() => expect(doc.querySelector(".row-name")?.textContent).toBe("Company x"));
    expect(calls.filter((c) => c.name === "leadbay_followups_map")).toHaveLength(0);
    expect((doc.getElementById("city-input") as HTMLInputElement).value).toBe("Lyon");
    expect(doc.documentElement.getAttribute("data-lb-surface")).toBe("mcp-app");
  });

  it("as an MCP Apps view in French", async () => {
    const { doc } = boot({
      html: ARTIFACT_TEMPLATES.route_planner.html,
      host: { args: {}, result: { structuredContent: followups }, context: { locale: "fr-FR" } },
    });
    await vi.waitFor(() => expect(doc.querySelector(".row-name")?.textContent).toBe("Company x"));
    expect(doc.querySelector("h1")!.textContent).toBe("Planificateur de tournée");
    expect(doc.getElementById("city-submit")!.textContent).toBe("Afficher les relances");
    expect(doc.body.textContent).toContain("Relances sur la carte");
  });

  it("on cowork it now loads through the kit (it used to need claude.ai's runtime)", async () => {
    const { doc, calls } = boot({
      html: ARTIFACT_TEMPLATES.route_planner.html,
      cowork: true,
      onTool: (name) => (name === "leadbay_followups_map" ? followups : {}),
    });
    await vi.waitFor(() => expect(doc.querySelector(".row-name")?.textContent).toBe("Company x"));
    expect(calls.some((c) => c.name === "leadbay_followups_map")).toBe(true);
  });

  it("on claude.ai it keeps its own connector bridge", async () => {
    const { doc, calls } = boot({
      html: ARTIFACT_TEMPLATES.route_planner.html,
      claude: true,
      onTool: (name) => (name === "leadbay_followups_map" ? followups : {}),
    });
    await vi.waitFor(() => expect(doc.querySelector(".row-name")?.textContent).toBe("Company x"));
    expect(calls.find((c) => c.name === "leadbay_followups_map")!.args).toMatchObject({ _origin: "artifact", count: 100 });
  });
});
