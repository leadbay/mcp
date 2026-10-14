import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { STYLES } from "../src/styles.js";

// The medium and low findings of the triage board's interface review: focus,
// spacing, contact lines, target size, naming, and the kit rules under them.

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, "../src/templates/triage-board/page.html"), "utf8");
const app = readFileSync(join(here, "../src/templates/triage-board/app.js"), "utf8");
const runtime = readFileSync(join(here, "../src/runtime.ts"), "utf8");

describe("keyboard focus stays where the rep is", () => {
  it("the kit gives a bound button its focus back when the write settles", () => {
    expect(runtime).toMatch(/document\.activeElement === el\) refocus = true/);
    expect(runtime).toMatch(/\(el as HTMLElement\)\.focus\(\{ preventScroll: true \}\)/);
  });

  it("the prospecting actions are aria-disabled while one saves, never disabled", () => {
    expect(app).toMatch(/b\.setAttribute\("aria-disabled", "true"\)/);
    expect(app).not.toMatch(/for \(const b of toggles\) b\.disabled = /);
  });

  it("the deck is inert and busy while a page loads", () => {
    expect(app).toMatch(/deck\.inert = true; deck\.setAttribute\("aria-busy", "true"\)/);
    expect(app).toMatch(/deck\.inert = false/);
  });
});

describe("one rhythm on every card", () => {
  it("the chips row hides with its chip", () => {
    expect(app).toMatch(/chipsRow\.hidden = tasteChip\.hidden/);
  });

  it("an empty status line leaves the flow but stays a live region", () => {
    expect(STYLES).toMatch(/\.lb-msg:empty\{position:absolute\}/);
  });
});

describe("the card's structure", () => {
  it("the company name is a heading and the checkbox has a 34px target", () => {
    expect(app).toMatch(/h\("h2", \{ class: "lb-lead-title" \}/);
    expect(app).toMatch(/h\("label", \{ class: "lb-pick" \}, pick\)/);
    expect(STYLES).toMatch(/\.lb-card-top>\.lb-pick\{[^}]*width:2\.5rem;height:2\.5rem/);
    expect(STYLES).toMatch(/\.lb-lead-title\{margin:0;/);
  });

  it("contact lines are the skin's fact rows", () => {
    expect(app).toMatch(/h\("div", \{ class: "lb-facts company" \}/);
    expect(app).toMatch(/class: "lb-sub lb-fact"/);
    expect(app).not.toMatch(/companyLine/);
  });

  it("the tally is a live region", () => {
    expect(page).toMatch(/<span class="lb-tally" id="tally" role="status"><\/span>/);
  });
});

describe("one name per thing", () => {
  it("the note button says what it does", () => {
    expect(app).toMatch(/logOutreach: "Save note"/);
    expect(app).toMatch(/outreachLogged: "Note saved"/);
  });

  it("the filter and the card name the AI adjustment alike", () => {
    expect(app).toMatch(/verdict: "AI adjustment"/);
    expect(app).toMatch(/boostedOpt: "AI boost"/);
    expect(app).toMatch(/aiPenalty: "AI penalty −\{n\}"/);
    expect(app).toMatch(/verdict: "Ajustement IA"/);
  });

  it("a single lead's chip is singular in French", () => {
    expect(app).toMatch(/likedChip: "Aimé"/);
    expect(app).toMatch(/t\("likedChip"\)/);
  });

  it("the kit's write errors are French on a French board", () => {
    expect(runtime).toMatch(/Statut non appliqué : /);
    expect(runtime).toMatch(/Quota atteint — aucun lead mis en file\. Réessayez/);
  });
});

describe("typographic punctuation in the labels", () => {
  const dict = app.slice(app.indexOf("const t = lb.i18n({"), app.indexOf("const ACTIONS = ["));
  const values = [...dict.matchAll(/^\s+\w+: "(.*)",$/gm)].map((m) => m[1]);

  it("no label uses a straight apostrophe", () => {
    expect(values.filter((v) => v.includes("'"))).toEqual([]);
  });

  it("French ties ? ! ; : and « » to their words with a narrow no-break space", () => {
    const fr = dict.slice(dict.indexOf("\n    fr: {"));
    expect(fr).not.toMatch(/ [?!;:]"/);
    expect(fr).not.toMatch(/« | »/);
    expect(fr).toMatch(/notePlaceholder: "Que s’est-il passé\\u202f\?"/);
  });
});

describe("kit rules under the board", () => {
  it("the focus ring no longer reshapes a button", () => {
    expect(STYLES).toMatch(/\.lb-link:focus-visible\{\s*outline:2px solid var\(--color-blue-foreground\);outline-offset:1px\}/);
    expect(STYLES).toMatch(/\.lb-link:focus-visible\{border-radius:var\(--lb-radius-sm\)\}/);
  });

  it("touch fields are 16px, so iOS does not zoom", () => {
    expect(STYLES).toMatch(/@media\(pointer:coarse\)\{\.lb-select,\.lb-input\{font-size:1rem\}\}/);
  });

  it("two icon buttons' targets no longer overlap", () => {
    expect(STYLES).toMatch(/\.lb-group>\.lb-btn-icon\+\.lb-btn-icon\{margin-inline-start:0\.25rem\}/);
  });

  it("the placeholder uses the muted token", () => {
    expect(STYLES).toMatch(/\.lb-input::placeholder\{color:var\(--lb-muted\);opacity:1\}/);
  });
});
