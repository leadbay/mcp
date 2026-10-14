import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// The triage board's header and toolbar layout: the count with the title,
// one toolbar row, bulk actions only with a selection.

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, "../src/templates/triage-board/page.html"), "utf8");
const app = readFileSync(join(here, "../src/templates/triage-board/app.js"), "utf8");

describe("the triage header and toolbar", () => {
  it("puts the lead count beside the title, not in the toolbar", () => {
    expect(page).toMatch(/<div class="page-title">\s*<h1 data-i18n="heading">[^<]*<\/h1>\s*<span class="lb-tally" id="tally" role="status"><\/span>/);
  });

  it("sets each filter's caption beside its picker, on a row centred on the controls", () => {
    expect(page).toMatch(/\.page \.lb-toolbar \{ align-items: center; \}/);
    expect(page).toMatch(/\.page \.lb-toolbar \.filter \{ flex-direction: row;/);
  });

  it("shows the status picker and Apply only once something is selected", () => {
    expect(page).toMatch(/<span class="bulk-act" id="bulk-act" hidden>/);
    expect(app).toMatch(/document\.getElementById\("bulk-act"\)\.hidden = n === 0/);
    expect(app).toMatch(/selectedMany: "\{n\} sélectionnés"/);
  });
});
