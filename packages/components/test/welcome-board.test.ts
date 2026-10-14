import { describe, it, expect, vi } from "vitest";
import { JSDOM } from "jsdom";
import { ARTIFACT_TEMPLATES } from "../../core/src/artifact-templates.generated.js";

// The welcome board (template "onboarding"), booted for real on both surfaces:
//
//   MCP Apps   renders the leadbay_welcome call that opened it; its buttons
//              post the phrase into the chat with ui/message
//   Claude     reads the account itself; its buttons copy the phrase, since
//              an artifact cannot write into the conversation
//   both       the web app's welcome card, each empty section hidden; French

type Msg = Record<string, any>;

interface Boot {
  host?: { result?: unknown; context?: Record<string, unknown>; capabilities?: Record<string, unknown> };
  cowork?: boolean;
  lang?: string;
  onTool?: (name: string, args: Record<string, unknown>) => unknown;
  clipboard?: (text: string) => Promise<void>;
  /** A published claude.ai artifact: `use("mcp")` reaches Leadbay and
   *  `use("room")` answers with this send state and records each send. */
  claudeRoom?: { state: string; sends: { data: any; options: any; inClick: boolean }[]; reject?: boolean };
}

const WELCOME = {
  user: { name: "Camille Durand", first_name: "Camille" },
  organization: { name: "Acme Flooring", computing_intelligence: false },
  leadpass: {
    purchase_intent_tags: ["New Site Opening", "Facility Remodel"],
    qualification_questions: ["Do they run rolling loads?", "Do they own their sites?"],
    ideal_buyer_profile: { summary: "Operators of busy facilities.", key_characteristics: ["30–160 employees"], anti_patterns: [] },
    targeting_prompt: null,
  },
  first_run: true,
  board: { template: "onboarding" },
  starters: [],
};

function boot(o: Boot) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const messages: Msg[] = [];
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
        reply({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2026-01-26", hostInfo: {}, hostCapabilities: o.host?.capabilities ?? {}, hostContext: o.host?.context ?? {} } });
      } else if (m.method === "ui/notifications/initialized") {
        reply({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: {} } });
        if (o.host?.result !== undefined) reply({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: o.host.result });
      } else if (m.method === "tools/call") {
        reply({ jsonrpc: "2.0", id: m.id, result: { structuredContent: answer(m.params.name, m.params.arguments) } });
      } else if (m.method === "ui/message") {
        messages.push(m.params);
        reply({ jsonrpc: "2.0", id: m.id, result: {} });
      }
    },
  };
  const dom = new JSDOM(ARTIFACT_TEMPLATES.onboarding.html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(w: any) {
      win = w;
      w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
      if (o.lang) Object.defineProperty(w.navigator, "languages", { value: [o.lang], configurable: true });
      if (o.host) Object.defineProperty(w, "parent", { value: parent, configurable: true });
      if (o.cowork) w.cowork = { callMcpTool: async (name: string, args: any) => answer(name, args) };
      if (o.clipboard) Object.defineProperty(w.navigator, "clipboard", { value: { writeText: o.clipboard }, configurable: true });
      if (o.claudeRoom) {
        const r = o.claudeRoom;
        const room = {
          canSendToClaudeSession: async () => r.state,
          sendToClaudeSession: (data: any, options: any) => {
            r.sends.push({ data, options, inClick: (w as any).__inClick === true });
            return r.reject ? Promise.reject(Object.assign(new Error("no"), { code: "claude_unavailable" })) : Promise.resolve({ to: "pane" });
          },
        };
        const mcp = { callTool: async (_s: string, name: string, args: any) => ({ payload: answer(name, args) }) };
        w.claude = { use: async (n: string) => (n === "room" ? room : n === "mcp" ? mcp : null) };
      }
    },
  });
  return { doc: dom.window.document as Document, calls, messages };
}

const opening = (result: unknown = WELCOME) => ({ result: { structuredContent: result } });
const text = (doc: Document, sel: string) => doc.querySelector(sel)!.textContent;

describe("the welcome board as an MCP Apps view", () => {
  it("renders the call that opened it — no second leadbay_welcome", async () => {
    const { doc, calls } = boot({ host: opening() });
    await vi.waitFor(() => expect(text(doc, "h1")).toBe("Welcome to Leadbay, Camille!"));
    expect(text(doc, "#subtitle")).toBe("Here's what our AI learned about Acme Flooring.");
    expect(calls.filter((c) => c.name === "leadbay_welcome")).toHaveLength(0);
  });

  it("shows the web app's welcome card, hiding what Leadbay has nothing for", async () => {
    const { doc } = boot({ host: opening() });
    await vi.waitFor(() => expect((doc.getElementById("learned") as HTMLElement).hidden).toBe(false));
    // Same teal intent-tag style as the triage board's cards.
    expect(doc.getElementById("tags")!.className).toBe("lb-tags-intent");
    expect([...doc.querySelectorAll("#tags > span")].map((c) => c.textContent)).toEqual(["New Site Opening", "Facility Remodel"]);
    expect([...doc.querySelectorAll("#questions li")].map((li) => li.textContent)).toEqual(["01Do they run rolling loads?", "02Do they own their sites?"]);
    // A bold "Summary:" lead-in introduces the summary text.
    expect(doc.querySelector("#ibp-summary strong")!.textContent).toBe("Summary:");
    expect(text(doc, "#ibp-summary")).toBe("Summary: Operators of busy facilities.");
    // No anti-patterns came back: the Disqualifiers column hides, as on the web.
    expect((doc.getElementById("ibp-no-col") as HTMLElement).hidden).toBe(true);
  });

  it("a fragment summary still reads as a labelled line, in French typography", async () => {
    const fragment = { ...WELCOME, leadpass: { ...WELCOME.leadpass, ideal_buyer_profile: { summary: " pour les équipes commerciales B2B.", key_characteristics: [], anti_patterns: [] } } };
    const { doc } = boot({ host: { ...opening(fragment), context: { locale: "fr-FR" } } });
    await vi.waitFor(() => expect(text(doc, "#ibp-summary")).toBe("Résumé : pour les équipes commerciales B2B."));
  });

  it("hides the whole card and says so plainly when nothing has been learned yet", async () => {
    const empty = { ...WELCOME, organization: { name: "Acme", computing_intelligence: true }, leadpass: { purchase_intent_tags: [], qualification_questions: null, ideal_buyer_profile: null } };
    const { doc } = boot({ host: opening(empty) });
    await vi.waitFor(() => expect(text(doc, "#subtitle")).toBe("Here's what you can ask Leadbay to do, right from this chat."));
    expect((doc.getElementById("learned") as HTMLElement).hidden).toBe(true);
    expect((doc.getElementById("computing") as HTMLElement).hidden).toBe(false);
  });

  it("a card's button posts its phrase into the chat when the host takes messages", async () => {
    const { doc, messages } = boot({ host: { ...opening(), capabilities: { message: { text: {} } } } });
    const btn = () => doc.querySelector('[data-ask="leads"]') as HTMLButtonElement;
    await vi.waitFor(() => expect(btn().textContent).toBe("Ask Leadbay"));
    btn().click();
    await vi.waitFor(() => expect(messages).toHaveLength(1));
    expect(messages[0]).toEqual({ role: "user", content: [{ type: "text", text: "Show me today's leads" }] });
    // The buttons run here, so there is no "click a suggestion in the chat" hint.
    expect((doc.getElementById("chat-hint") as HTMLElement).hidden).toBe(true);
  });

  it("one card covers both parts of the taste profile the chat can change", async () => {
    const { doc, messages } = boot({ host: { ...opening(), capabilities: { message: {} } } });
    await vi.waitFor(() => expect(text(doc, "h1")).toBe("Welcome to Leadbay, Camille!"));
    expect(doc.querySelector('[data-ask="questions"]')).toBeNull();
    (doc.querySelector('[data-ask="refine"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(messages).toHaveLength(1));
    expect(messages[0].content[0].text).toBe("I want to refine my targeting and qualification questions");
  });

  it("the footer's one action is the live onboarding, as the primary button — no tour button", async () => {
    const { doc } = boot({ host: opening() });
    await vi.waitFor(() => expect(text(doc, "h1")).toBe("Welcome to Leadbay, Camille!"));
    const live = doc.getElementById("live") as HTMLAnchorElement;
    expect(live.href).toBe("https://luma.com/workshopleadbay");
    expect(live.classList.contains("lb-btn-submit")).toBe(true);
    expect(doc.getElementById("tour")).toBeNull();
    expect(doc.querySelectorAll("footer .lb-btn").length).toBe(1);
  });

  it("the cards keep their own layout over the skin's card grid, so buttons line up and fit their label", () => {
    const html = ARTIFACT_TEMPLATES.onboarding.html;
    expect(html).toMatch(/\.lb-card\.ask \{[^}]*display: flex; flex-direction: column;/);
    expect(html).toMatch(/\.lb-card\.learned \{[^}]*display: flex; flex-direction: column;/);
    expect(html).toMatch(/\.ask \.lb-btn \{[^}]*width: auto; white-space: nowrap;/);
  });

  it("each card's button is told apart by its card's title", async () => {
    const { doc } = boot({ host: opening() });
    await vi.waitFor(() => expect(doc.getElementById("asks")!.hasAttribute("data-ready")).toBe(true));
    const btn = doc.querySelector('[data-ask="map"]')!;
    const described = doc.getElementById(btn.getAttribute("aria-describedby")!)!;
    expect(described.textContent).toBe("Plan a trip");
  });

  it("the status line stays in the page while empty, so screen readers announce it", () => {
    const html = ARTIFACT_TEMPLATES.onboarding.html;
    expect(html).not.toMatch(/\.lb-msg:empty \{ display: none/);
  });

  it("holds the buttons until the host is known, so the label never flips", async () => {
    const { doc } = boot({ host: opening() });
    expect(doc.getElementById("asks")!.hasAttribute("data-ready")).toBe(false);
    await vi.waitFor(() => expect(doc.getElementById("asks")!.hasAttribute("data-ready")).toBe(true));
  });

  it("has a main landmark, hides the visual question numbers and says links open a new tab", async () => {
    const { doc } = boot({ host: opening() });
    await vi.waitFor(() => expect(doc.querySelectorAll("#questions li").length).toBe(2));
    expect(doc.querySelector("main.page")).not.toBeNull();
    expect(doc.querySelector("#questions .n")!.getAttribute("aria-hidden")).toBe("true");
    const edit = doc.querySelector(".learned-foot a")!;
    expect(edit.textContent).toBe("Edit your taste profile ↗ (opens in a new tab)");
    expect(edit.querySelector('[aria-hidden="true"]')!.textContent).toBe(" ↗");
    expect(doc.querySelector("#live .lb-vh")!.textContent).toBe(" (opens in a new tab)");
  });

  it("nothing static wears the link blue", () => {
    const html = ARTIFACT_TEMPLATES.onboarding.html;
    expect(html).toMatch(/\.ask h3 svg \{[^}]*color: var\(--lb-fg\)/);
    expect(html).toMatch(/\.questions \.n \{[^}]*color: var\(--lb-muted\)/);
  });

  it("headings descend: title > section > card", () => {
    const html = ARTIFACT_TEMPLATES.onboarding.html;
    const px = (name: string) => Number(html.match(new RegExp(`--ob-${name}: (\\d+)px`))![1]);
    expect(px("title")).toBeGreaterThan(px("section"));
    expect(px("section")).toBeGreaterThan(px("card"));
  });

  it("sets the page language to the labels' language", async () => {
    const { doc } = boot({ host: { ...opening(), context: { locale: "fr-FR" } } });
    await vi.waitFor(() => expect(doc.documentElement.lang).toBe("fr"));
  });

  it("the live onboarding button fits its label: the footer stays a row, not the skin's card grid", () => {
    // The skin's `.lb-card{display:grid}` loads after the page's sheet, so the
    // footer rule needs `.lb-card.foot` to win, or the button spans the card.
    const html = ARTIFACT_TEMPLATES.onboarding.html;
    expect(html).toMatch(/\.lb-card\.foot \{ display: flex;/);
    expect(html).toMatch(/\.foot \.lb-btn \{[^}]*width: auto; max-width: 100%;/);
    // It may wrap: the French label only just fits a 320px screen.
    expect(html).toMatch(/\.foot \.lb-btn \{[^}]*white-space: normal;/);
  });

  it("never sends a message to a host that did not offer to take one", async () => {
    let copied = "";
    const { doc, messages } = boot({ host: opening(), clipboard: async (t) => void (copied = t) });
    const btn = () => doc.querySelector('[data-ask="follow"]') as HTMLButtonElement;
    await vi.waitFor(() => expect(text(doc, "h1")).toBe("Welcome to Leadbay, Camille!"));
    expect(btn().textContent).toBe("Copy the phrase");
    btn().click();
    await vi.waitFor(() => expect(copied).toBe("Which leads should I follow up with?"));
    expect(messages).toHaveLength(0);
  });

  it("labels itself — and its phrases — in French when the host's locale is French", async () => {
    const { doc, messages } = boot({ host: { ...opening(), context: { locale: "fr-FR" }, capabilities: { message: {} } } });
    await vi.waitFor(() => expect(text(doc, "h1")).toBe("Bienvenue sur Leadbay, Camille !"));
    expect(text(doc, "#subtitle")).toBe("Voici ce que notre IA a appris sur Acme Flooring.");
    expect(text(doc, '[data-i18n="ibpLabel"]')).toBe("Profil de l'acheteur idéal");
    (doc.querySelector('[data-ask="leads"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(messages).toHaveLength(1));
    expect(messages[0].content[0].text).toBe("Montre-moi les leads du jour");
  });
});

describe("the welcome board reaches the Claude chat through the room capability", () => {
  // Click the way a viewer does: claude.ai only takes a send it can tie to
  // the gesture, so the board must call sendToClaudeSession inside the click.
  const click = (doc: Document, key: string) => {
    const win = doc.defaultView as any;
    win.__inClick = true;
    (doc.querySelector(`[data-ask="${key}"]`) as HTMLButtonElement).click();
    win.__inClick = false;
  };
  const ready = (doc: Document) => vi.waitFor(() => expect(doc.getElementById("asks")!.hasAttribute("data-ready")).toBe(true));

  it("sends the card's request to the chat, from the click, for Claude to confirm and run", async () => {
    const claudeRoom = { state: "available", sends: [] as any[] };
    const { doc } = boot({ claudeRoom, onTool: () => WELCOME });
    await ready(doc);
    expect(doc.querySelector('[data-ask="leads"]')!.textContent).toBe("Ask Leadbay");
    expect((doc.getElementById("chat-hint") as HTMLElement).hidden).toBe(true);
    click(doc, "leads");
    expect(claudeRoom.sends).toHaveLength(1);
    expect(claudeRoom.sends[0]).toEqual({
      data: { from: "leadbay_welcome_board", request: "Show me today's leads", label: "See today's leads" },
      options: { deliver: "send" },
      inClick: true,
    });
    await vi.waitFor(() => expect(doc.querySelector('[data-ask="leads"]')!.nextElementSibling!.textContent).toBe("Sent to the chat."));
  });

  it("where only a staged send is offered, the request waits in the composer", async () => {
    const claudeRoom = { state: "available_if_opened", sends: [] as any[] };
    const { doc } = boot({ claudeRoom, onTool: () => WELCOME });
    await ready(doc);
    click(doc, "follow");
    expect(claudeRoom.sends[0].options).toEqual({ deliver: "stage" });
    await vi.waitFor(() => expect(doc.querySelector('[data-ask="follow"]')!.nextElementSibling!.textContent).toBe("Ready in your chat: press Enter to send it."));
  });

  it("with no conversation to take it, the buttons copy and the board points to the chat's suggestions", async () => {
    const claudeRoom = { state: "no_session", sends: [] as any[] };
    let copied = "";
    const { doc } = boot({ claudeRoom, onTool: () => WELCOME, clipboard: async (t) => void (copied = t) });
    await ready(doc);
    expect(doc.querySelector('[data-ask="map"]')!.textContent).toBe("Copy the phrase");
    expect((doc.getElementById("chat-hint") as HTMLElement).hidden).toBe(false);
    click(doc, "map");
    await vi.waitFor(() => expect(copied).toBe("Show my follow-ups on a map"));
    expect(claudeRoom.sends).toHaveLength(0);
  });

  it("a refused send falls back to copying the phrase", async () => {
    const claudeRoom = { state: "available", sends: [] as any[], reject: true };
    let copied = "";
    const { doc } = boot({ claudeRoom, onTool: () => WELCOME, clipboard: async (t) => void (copied = t) });
    await ready(doc);
    click(doc, "leads");
    await vi.waitFor(() => expect(copied).toBe("Show me today's leads"));
  });
});

describe("the welcome board as a Claude artifact", () => {
  it("reads the account itself, with its own _triggered_by", async () => {
    const { doc, calls } = boot({ cowork: true, onTool: (name) => (name === "leadbay_welcome" ? WELCOME : {}) });
    await vi.waitFor(() => expect(text(doc, "h1")).toBe("Welcome to Leadbay, Camille!"));
    expect(calls.find((c) => c.name === "leadbay_welcome")!.args).toEqual({ _triggered_by: "Welcome board" });
  });

  it("points to the chat's suggestions, since its own buttons can only copy", async () => {
    const { doc } = boot({ cowork: true, onTool: () => WELCOME });
    await vi.waitFor(() => expect((doc.getElementById("chat-hint") as HTMLElement).hidden).toBe(false));
    expect(text(doc, "#chat-hint")).toBe("To start right away, pick one of the suggestions in the chat. Or copy any phrase below and paste it.");
  });

  it("its buttons copy the phrase — an artifact cannot write into the chat", async () => {
    let copied = "";
    const { doc } = boot({ cowork: true, onTool: () => WELCOME, clipboard: async (t) => void (copied = t) });
    const btn = () => doc.querySelector('[data-ask="map"]') as HTMLButtonElement;
    await vi.waitFor(() => expect(text(doc, "h1")).toBe("Welcome to Leadbay, Camille!"));
    expect(btn().textContent).toBe("Copy the phrase");
    btn().click();
    await vi.waitFor(() => expect(btn().nextElementSibling!.textContent).toBe("Copied — paste it in the chat."));
    expect(copied).toBe("Show my follow-ups on a map");
  });

  it("when the clipboard is blocked too, it selects the phrase and says to paste it", async () => {
    const { doc } = boot({ cowork: true, onTool: () => WELCOME, clipboard: async () => { throw new Error("denied") } });
    const btn = () => doc.querySelector('[data-ask="map"]') as HTMLButtonElement;
    await vi.waitFor(() => expect(text(doc, "h1")).toBe("Welcome to Leadbay, Camille!"));
    btn().click();
    await vi.waitFor(() => expect(btn().nextElementSibling!.textContent).toBe("The phrase is selected: copy it and paste it in the chat."));
  });

  it("still offers everything to ask when the account cannot be read", async () => {
    const { doc } = boot({ cowork: true, onTool: () => { throw new Error("down") } });
    await vi.waitFor(() => expect(text(doc, "#subtitle")).toBe("Your account could not be read just now — everything below still works."));
    expect(doc.querySelectorAll(".ask").length).toBe(8);
    expect(text(doc, "h1")).toBe("Welcome to Leadbay!");
  });
});
