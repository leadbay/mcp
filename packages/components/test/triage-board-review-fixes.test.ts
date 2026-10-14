import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { STYLES } from "../src/styles.js";

// Fixes from an interface review of the triage board: each was a failure a
// user could hit, not a matter of taste.

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, "../src/templates/triage-board/page.html"), "utf8");
const app = readFileSync(join(here, "../src/templates/triage-board/app.js"), "utf8");

describe("the triage board after its interface review", () => {
  it("fits a 320px screen: the card column never asks for more than the width it has", () => {
    expect(page).toMatch(/minmax\(min\(320px, 100%\), 1fr\)/);
    expect(page).not.toMatch(/minmax\(320px, 1fr\)/);
  });

  it("shows a ticked prospecting action by a ✓ too, not colour alone", () => {
    expect(page).toMatch(/\.lb-action\[aria-checked="true"\]::after\s*\{\s*content:\s*"✓"/);
  });

  it("colours the verdict with the text-role tokens that pass AA", () => {
    expect(page).toMatch(/\.verdict\[data-v="boosted"\]\s*\{\s*color:\s*var\(--lb-text-green\)/);
    expect(page).toMatch(/\.verdict\[data-v="penalised"\]\s*\{\s*color:\s*var\(--lb-text-red\)/);
  });

  it("says a failed first load failed, with a way to try again, instead of 'no lead matches'", () => {
    expect(app).toMatch(/state\.failed = !state\.leads\.length/);
    expect(app).toMatch(/t\("loadFailedFirst"\)/);
    expect(app).toMatch(/text: t\("retry"\)/);
    expect(app).toMatch(/retry: "Try again"/);
    expect(app).toMatch(/retry: "Réessayer"/);
  });

  it("gives every error a next step", () => {
    expect(app).toMatch(/saveFailed: "Could not save\. Try again\."/);
    expect(app).toMatch(/loadFailed: "Could not load that page\. Check your connection, then choose the page again\."/);
  });

  it("keeps a clamped excerpt reachable with a Show more toggle", () => {
    expect(app).toMatch(/class: "excerpt-toggle"/);
    expect(app).toMatch(/"aria-expanded"/);
    expect(page).toMatch(/\.excerpt\[data-open\]/);
  });

  it("drops the button press movement under reduced motion, keeping a dim", () => {
    expect(STYLES).toMatch(/@media\(prefers-reduced-motion:reduce\)\{\s*\.lb-btn\{transition:[^}]*\}\s*\.lb-btn:active:not\(\[disabled\]\):not\(\[data-lb-state=loading\]\)\{transform:none;opacity:\.85\}\}/);
  });
});
