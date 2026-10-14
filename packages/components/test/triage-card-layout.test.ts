import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// The triage card's layout: two groups by space, the note on one row, the
// LinkedIn mark beside the linked contact.

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, "../src/templates/triage-board/page.html"), "utf8");
const app = readFileSync(join(here, "../src/templates/triage-board/app.js"), "utf8");

describe("the triage card's layout", () => {
  it("starts the act group (Status onward) further down than the 16px section rhythm", () => {
    expect(app).toMatch(/h\("div", \{ class: "lb-section act-start" \},\s*h\("div", \{ class: "lb-sec-title", text: t\("status"\) \}\)/);
    expect(page).toMatch(/\.lb-section\.act-start \{ margin-block-start: 0\.75rem; \}/);
  });

  it("puts the note field and its button on one row", () => {
    expect(app).toMatch(/h\("div", \{ class: "lb-row note-row" \}, noteInput, noteBtn\)/);
    expect(page).toMatch(/\.note-row > \.lb-btn \{ flex: 0 0 auto; width: auto;/);
  });

  it("separates the recommended contact from the company's own lines", () => {
    expect(app).toMatch(/h\("div", \{ class: "lb-sec-title", text: t\("contactTitle"\) \}\)/);
    expect(app).toMatch(/h\("div", \{ class: "lb-sec-title", text: t\("companyTitle"\) \}\)/);
    expect(app).toMatch(/href: "tel:" \+ phone/);
    expect(app).toMatch(/href: "mailto:" \+ email/);
  });

  it("renders every company social profile Leadbay sends, never a fixed list", () => {
    expect(app).toMatch(/Object\.entries\(\(lead\.social_urls && typeof lead\.social_urls === "object"\)/);
    expect(app).toMatch(/socials\.length \? h\("div", \{ class: "socials" \}, socials\) : null/);
  });

  it("makes each social link icon-only: the platform's mark, a tooltip and a label", () => {
    expect(app).toMatch(/title: label,\s*"aria-label": t\("socialAria", \{ platform: label, name \}\) \}, socialIcon\(key\)\)/);
    for (const key of ["linkedin", "facebook", "instagram", "twitter", "tiktok", "crunchbase"]) {
      expect(app).toMatch(new RegExp(`"${key}": "M`));
    }
    expect(page).toMatch(/\.social::before \{ content: ""; position: absolute; inset: -4px; \}/);
  });

  it("sets the LinkedIn mark inline before the contact's linked name", () => {
    expect(app).toMatch(/class: "lb-link li-link"[\s\S]*?\}, linkedinIcon\(\), h\("span", \{ text: who \}\)\)/);
    expect(page).toMatch(/\.li-link \{ display: inline-flex; align-items: center; gap: 4px;/);
  });
});
