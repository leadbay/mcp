import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// The make-interfaces-feel-better pass over the three boards: hit areas,
// concentric corners, icon stroke, text wrapping, a soft exit.

const here = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(join(here, "../src/templates", p), "utf8");
const route = read("route-planner/page.html");
const routeApp = read("route-planner/app.js");
const triage = read("triage-board/page.html");
const triageApp = read("triage-board/app.js");
const welcome = read("onboarding/page.html");

describe("hit areas", () => {
  it("route planner icon buttons reach 40px, and the stop tools never overlap", () => {
    expect(route).toMatch(/\.icon-btn::before \{ content: ""; position: absolute; inset: -4px; \}/);
    expect(route).toContain(".stop-tools { display: flex; gap: 8px; }");
    expect(route).toContain(".stop-tools .icon-btn { width: 32px; height: 32px; }");
  });

  it("the triage excerpt toggle has an overhang", () => {
    expect(triage).toMatch(/\.excerpt-toggle::before \{ content: ""; position: absolute; inset: -12px -8px; \}/);
  });
});

describe("concentric corners", () => {
  it("the route planner's panel and map frame are 26px (10px inside + 16px padding)", () => {
    expect(route).toMatch(/\.panel \{[^}]*border-radius: 26px;/);
    expect(route).toMatch(/\.map-frame \{[^}]*border-radius: 26px;/);
  });

  it("the welcome icon tile follows the card corner (24 − 14 = 10px)", () => {
    expect(welcome).toMatch(/\.ask \.ico \{[^}]*border-radius: 10px;/);
  });
});

describe("icons and text", () => {
  it("the Open in Leadbay arrow is a 1.5px stroke beside regular text", () => {
    expect(triageApp).toMatch(/s\.setAttribute\("stroke-width", "1\.5"\)/);
    expect(triageApp).not.toMatch(/svg\(ICON\.out\)\),/);
  });

  it("wrapping body text has no lone last word", () => {
    expect(triage).toMatch(/\.page-head p \{[^}]*text-wrap: pretty;/);
    for (const sel of [".city-hint", ".notice", ".empty"]) {
      expect(route).toMatch(new RegExp(`\\${sel} \\{[^}]*text-wrap: pretty;`));
    }
  });
});

describe("a soft exit", () => {
  it("a removed route stop fades and lifts 4px before the list redraws", () => {
    expect(routeApp).toMatch(/transform: "translateY\(-4px\)" \}\],\s*\{ duration: 150/);
    expect(routeApp).toMatch(/if \(!row \|\| !row\.animate \|\| prefersReducedMotion\(\)\) return remove\(\)/);
  });
});
