import { describe, it, expect, beforeEach } from "vitest";
import { lb, configure, styles } from "../src/runtime.js";
import { STYLES, STYLE_ELEMENT_ID } from "../src/styles.js";

// The optional artifact skin added in 0.5.0. It must stay OPT-IN (an artifact
// that never calls lb.styles() gets exactly the HTML it wrote), idempotent, and
// safe on a host with no document.

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  configure({});
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  delete (globalThis as { cowork?: unknown }).cowork;
});

describe("lb.styles", () => {
  it("is opt-in — nothing is injected until it is called", () => {
    expect(document.getElementById(STYLE_ELEMENT_ID)).toBeNull();
    lb.leadStatus("WON");
    lb.setStatus({ leadId: "a", status: lb.leadStatus("WON") });
    // Building view-models must never inject a stylesheet.
    expect(document.getElementById(STYLE_ELEMENT_ID)).toBeNull();
  });

  it("injects one <style> carrying the sheet", () => {
    const el = styles();
    expect(el).not.toBeNull();
    expect(el!.tagName).toBe("STYLE");
    expect(el!.id).toBe(STYLE_ELEMENT_ID);
    expect(el!.textContent).toBe(STYLES);
    expect(document.head.querySelectorAll("style").length).toBe(1);
  });

  it("is idempotent — repeated calls inject once and return the same node", () => {
    const a = styles();
    const b = styles();
    const c = lb.styles();
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(document.head.querySelectorAll("style").length).toBe(1);
  });

  it("is reachable from the public surface", () => {
    expect(typeof lb.styles).toBe("function");
  });
});

describe("the sheet itself", () => {
  it("scopes every class under lb- so it cannot collide with agent markup", () => {
    const classes = STYLES.match(/\.[a-zA-Z][\w-]*/g) ?? [];
    const unscoped = [...new Set(classes)].filter((c) => !c.startsWith(".lb-"));
    expect(unscoped).toEqual([]);
  });

  it("carries the frontend design-system colour tokens verbatim", () => {
    // Lifted from frontend/packages/style/color.css — the product palette, not
    // an invented one. If these drift, an artifact stops looking like Leadbay.
    for (const [token, value] of [
      ["--color-black", "#191919"],
      ["--color-gray-1", "#f9f9f9"],
      ["--color-gray-9", "#202020"],
      ["--color-green-foreground", "oklch(0.564 0.181 141)"],
      ["--color-red-foreground", "oklch(0.564 0.191 26)"],
      ["--color-blue-foreground", "oklch(0.564 0.181 251)"],
    ] as const) {
      expect(STYLES).toContain(`${token}:${value}`);
    }
  });

  it("aliases the palette into component-local vars, the Toast.module.css pattern", () => {
    for (const token of ["--lb-surface", "--lb-border", "--lb-fg", "--lb-muted", "--lb-field"]) {
      expect(STYLES).toContain(token + ":");
    }
  });

  it("themes dark via BOTH data-theme and prefers-color-scheme", () => {
    // data-theme mirrors the frontend's Toast hook; prefers-color-scheme is
    // required too because an artifact cannot set an attribute on its host.
    expect(STYLES).toContain("[data-theme=dark]");
    expect(STYLES).toContain("@media(prefers-color-scheme:dark)");
    const dark = STYLES.slice(STYLES.indexOf("@media(prefers-color-scheme:dark)"));
    for (const token of ["--lb-surface", "--lb-fg", "--lb-border"]) {
      expect(dark).toContain(token + ":");
    }
  });

  it("styles taste and CRM status as SEPARATE chip axes", () => {
    // A lead can be liked AND lost. If these ever share one attribute the two
    // facts overwrite each other and the rep loses the "liked but went nowhere"
    // signal, so the skin must keep data-taste and data-status independent.
    for (const s of ["WANTED", "WON", "LOST", "UNWANTED"]) {
      expect(STYLES).toContain(`[data-status=${s}]`);
    }
    for (const t of ["liked", "disliked"]) {
      expect(STYLES).toContain(`[data-taste=${t}]`);
    }
    // liked uses the product's own like colour, not a generic red
    expect(STYLES).toContain("--color-red-like:var(--color-cherry-foreground)");
    expect(STYLES).toContain(".lb-chips{");
  });

  it("uses the frontend's radii + squircle corners", () => {
    // Concentric: outer = inner + padding (0.625 + 0.875 = 1.5rem).
    expect(STYLES).toContain("--lb-radius:1.5rem");
    expect(STYLES).toContain("--lb-radius-sm:0.625rem");
    expect(STYLES).toContain("corner-shape:squircle");
  });

  it("names the product font first, with a system fallback and no remote @font-face", () => {
    expect(STYLES).toContain('"Nikkei Maru"');
    expect(STYLES).toContain("system-ui");
    // Artifacts are inline-only — a CDN @font-face would silently fail.
    expect(STYLES).not.toContain("@font-face");
  });

  it("styles the data-lb-state values the bind helpers actually set", () => {
    for (const state of ["loading", "success", "error", "unavailable"]) {
      expect(STYLES).toContain("data-lb-state=" + state);
    }
  });

  it("respects prefers-reduced-motion for the spinner", () => {
    expect(STYLES).toContain("prefers-reduced-motion");
  });
});

describe("skin + view-models together", () => {
  it("a styled button still reflects action state through data-lb-state", async () => {
    let resolveCall!: (v: unknown) => void;
    configure({ call: () => new Promise((r) => (resolveCall = r)) });
    lb.styles();

    document.body.innerHTML =
      '<button id="go" class="lb-btn"></button><select id="st" class="lb-select"></select>';
    const btn = document.getElementById("go") as HTMLButtonElement;
    const sel = document.getElementById("st") as HTMLSelectElement;

    const status = lb.leadStatus("WON");
    lb.bindSelect(sel, status);
    const save = lb.setStatus({ leadId: "a", status });
    lb.bindAction(btn, save);
    await tick();

    // The class is the agent's; the state attribute is the runtime's. Both present.
    expect(btn.className).toBe("lb-btn");
    btn.click();
    await tick();
    expect(btn.getAttribute("data-lb-state")).toBe("loading");

    resolveCall({ applied: true, count: 1, status: "WON", failed: [] });
    await tick();
    expect(btn.getAttribute("data-lb-state")).toBe("success");
    expect(btn.className).toBe("lb-btn"); // the runtime never rewrites classes
  });

  it("the runtime never adds classes to elements it binds", async () => {
    lb.styles();
    document.body.innerHTML = '<select id="st"></select>';
    const sel = document.getElementById("st") as HTMLSelectElement;
    lb.bindSelect(sel, lb.leadStatus("WON"));
    await tick();
    expect(sel.className).toBe("");
  });
});
