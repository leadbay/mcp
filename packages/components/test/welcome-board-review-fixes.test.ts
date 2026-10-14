import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { STYLES } from "../src/styles.js";

// Fixes from the welcome board's interface review.

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, "../src/templates/onboarding/page.html"), "utf8");
const app = readFileSync(join(here, "../src/templates/onboarding/app.js"), "utf8");
const bridge = readFileSync(join(here, "../src/mcp-app-bridge.ts"), "utf8");

describe("a failed account read has a way back", () => {
  it("shows Try again beside the subtitle and reads the account again", () => {
    expect(page).toMatch(/<button class="lb-btn retry" id="retry" type="button" hidden data-i18n="retry">/);
    expect(app).toMatch(/\$\("retry"\)\.hidden = !failed/);
    expect(app).toMatch(/\$\("retry"\)\.addEventListener\("click"/);
  });

  it("the subtitle is the one live region for loading, loaded and failed", () => {
    expect(page).toMatch(/<p id="subtitle" role="status"/);
    expect(page).not.toMatch(/id="computing" role="status"/);
  });
});

describe("layout", () => {
  it("the ask grid is 1, 2 or 4 columns, never 3 / 3 / 2", () => {
    expect(page).toMatch(/\.asks \{ display: grid; grid-template-columns: 1fr;/);
    expect(page).toMatch(/@media \(min-width: 988px\) \{ \.asks \{ grid-template-columns: repeat\(4, minmax\(0, 1fr\)\); \} \}/);
    expect(page).not.toMatch(/repeat\(auto-fill, minmax\(230px, 1fr\)\)/);
  });

  it("the learned card's titles sit a step under the page's sections", () => {
    expect(page).toMatch(/\.learned h2 \{ font-size: var\(--ob-card\); \}/);
  });

  it("a status line is reserved under each ask button", () => {
    expect(page).toMatch(/\.ask-act \{[^}]*min-height: calc\(/);
  });

  it("the footer needs no spacer", () => {
    expect(page).not.toMatch(/<span class="lb-spacer"><\/span>/);
    expect(page).toMatch(/\.lb-card\.foot \{ display: flex;[^}]*justify-content: space-between;/);
  });
});

describe("colour on the ask cards", () => {
  it("each icon sits on a tile tinted with its hue, one hue per pair of jobs, never blue", () => {
    expect(app).toMatch(/h\("span", \{ class: "ico", "data-hue": a\.hue \}, svg\(a\.icon\)\)/);
    const hues = [...app.matchAll(/hue: "(\w+)"/g)].map((m) => m[1]);
    expect(hues).toHaveLength(8);
    expect(new Set(hues)).toEqual(new Set(["purple", "teal", "green", "cherry"]));
    expect(page).toMatch(/\.ask \.ico \{[^}]*background: color-mix\(in oklch, var\(--ico\) 14%, var\(--lb-surface\)\)/);
  });
});

describe("motion", () => {
  it("late reveals drop their first-paint delay", () => {
    expect(app).toMatch(/const LATE = \["computing", "learned", "chat-hint"\]/);
    expect(app).toMatch(/\$\(id\)\.style\.animationDelay = "0ms"/);
  });

  it("the slide measures the ask grid, and skips anything still entering", () => {
    expect(app).toMatch(/document\.querySelector\("\.start > h2"\), \$\("asks"\)/);
    expect(app).toMatch(/!entering\(el\)/);
  });

  it("a host theme switch does not fade the buttons behind everything else", () => {
    expect(bridge).toMatch(/transition:none!important/);
  });
});

describe("the kit under the board", () => {
  it("links are underlined at rest", () => {
    expect(STYLES).toMatch(/\.lb-link\{color:var\(--lb-text-blue\);text-decoration:underline;/);
  });

  it("plain button outlines reach 3:1", () => {
    expect(STYLES).toContain("--lb-btn-border:var(--color-gray-6);");
    expect(STYLES).toContain("--lb-btn-border:var(--color-gray-7);");
  });

  it("intent tags wrap inside a narrow card", () => {
    expect(STYLES).toMatch(/\.lb-tags-intent>\*\{[^}]*max-width:100%;overflow-wrap:anywhere;/);
  });

  it("text-role colours are sRGB first, oklch on P3 screens", () => {
    expect(STYLES).toContain("--lb-text-blue:#006bbc;");
    expect(STYLES).toMatch(/@media\(color-gamut:p3\)\{:root\{--lb-text-blue:oklch\(0\.521 0\.181 251\)/);
  });
});

describe("copy", () => {
  it("French status lines agree with « la phrase »", () => {
    expect(app).toMatch(/copied: "Phrase copiée — collez-la dans la conversation\."/);
  });

  it("the buyer profile no longer claims CRM data a new user has not imported", () => {
    expect(app).toMatch(/ibpTip: "AI-learned profile of your ideal customer\."/);
  });

  it("French phrases are quoted « » on a French page", () => {
    // The source holds the narrow no-break spaces (U+202F) themselves.
    expect(app).toContain('lb.locale() === "fr" ? ["« ", " »"] : ["“", "”"]');
  });
});
