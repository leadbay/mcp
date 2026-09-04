import { describe, it, expect } from "vitest";
import { STYLES } from "../src/styles.js";
import { ARTIFACT_USAGE_GUIDE as GUIDE_TEXT } from "../../core/src/artifact-runtime.generated.js";

// The old styles.test.ts asserted "dark mode works" by checking that a
// prefers-color-scheme block exists and redefines --lb-surface/-fg/-border. It
// passed while the default chip rendered #e0e0e0 on #f0f0f0 — 1.16:1, an
// invisible label — because the semantic --color-*-{background,foreground}
// pairs were declared once on :root and never flipped.
//
// These tests compute real contrast from the declared tokens instead, so a
// regression fails on the number rather than on the presence of a rule.

// ── oklch → sRGB (CSS Color 4) ───────────────────────────────────────────────
const gamma = (t: number) =>
  t > 0.0031308 ? 1.055 * Math.pow(t, 1 / 2.4) - 0.055 : 12.92 * t;

function oklch(L: number, C: number, H: number): [number, number, number] {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb: [number, number, number] = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return rgb.map((v) => Math.max(0, Math.min(1, gamma(v)))) as [number, number, number];
}

const hex = (h: string): [number, number, number] =>
  [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];

const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (c: [number, number, number]) =>
  0.2126 * linear(c[0]) + 0.7152 * linear(c[1]) + 0.0722 * linear(c[2]);

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Read a declared token out of the sheet. `block` picks light (`:root{`) or the
 *  first dark block. Dark inherits anything it does not redeclare — the grey
 *  ramp and the other raw primitives live only in `:root` — so a miss in the
 *  dark block falls back to light, exactly as the cascade does. */
function token(name: string, block: "light" | "dark"): string {
  const read = (b: "light" | "dark"): string | null => {
    const start =
      b === "light" ? STYLES.indexOf(":root{") : STYLES.indexOf(":root[data-theme=dark]");
    const end = STYLES.indexOf("\n}", start);
    const m = STYLES.slice(start, end).match(new RegExp(`\\${name}\\s*:\\s*([^;]+);`));
    return m ? m[1].trim() : null;
  };
  const v = read(block) ?? (block === "dark" ? read("light") : null);
  if (!v) throw new Error(`${name} not declared in the ${block} block`);
  return v;
}

function resolve(value: string, block: "light" | "dark"): [number, number, number] {
  const v = value.trim();
  if (v.startsWith("#")) return hex(v.length === 4 ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}` : v);
  const ok = v.match(/oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/);
  if (ok) return oklch(+ok[1], +ok[2], +ok[3]);
  const ref = v.match(/var\((--[\w-]+)\)/);
  if (ref) return resolve(token(ref[1], block), block);
  throw new Error(`cannot resolve ${v}`);
}

const AA_BODY = 4.5;
const AA_NON_TEXT = 3;

describe("dark mode actually flips the semantic palette", () => {
  it("redefines every --color-*-{background,foreground} pair in BOTH dark blocks", () => {
    // The root cause of the 1.16:1 chip: these were :root-only, so a light
    // pastel background stayed put on a #202020 card.
    const blocks = STYLES.split("--lb-surface:var(--color-gray-9)").slice(1);
    expect(blocks.length).toBe(2); // [data-theme=dark] and prefers-color-scheme
    for (const b of blocks) {
      for (const hue of ["blue", "green", "red", "gold", "cherry"]) {
        expect(b).toContain(`--color-${hue}-background:`);
        expect(b).toContain(`--color-${hue}-foreground:`);
      }
    }
  });

  it("declares color-scheme so native select popups follow the theme", () => {
    // Without it a dark card opens a white native dropdown — the one dark-mode
    // surface custom properties cannot reach.
    expect(STYLES).toMatch(/[^-]color-scheme:light/);
    expect(STYLES).toMatch(/[^-]color-scheme:dark/);
  });
});

describe("dark-mode contrast, computed from the declared tokens", () => {
  const surface = () => resolve(token("--lb-surface", "dark"), "dark");

  it("the default chip label is readable (was 1.16:1)", () => {
    const fg = resolve(token("--lb-muted", "dark"), "dark");
    const bg = resolve(token("--lb-chip-bg", "dark"), "dark");
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(AA_BODY);
  });

  it("inline feedback clears AA on the dark card (error was 3.23, ok 3.79)", () => {
    for (const name of ["--color-red-foreground", "--color-green-foreground"]) {
      const fg = resolve(token(name, "dark"), "dark");
      expect(contrast(fg, surface())).toBeGreaterThanOrEqual(AA_BODY);
    }
  });

  it("links clear AA on the dark card (was 3.57:1)", () => {
    const fg = resolve(token("--color-blue-foreground", "dark"), "dark");
    expect(contrast(fg, surface())).toBeGreaterThanOrEqual(AA_BODY);
  });

  it("every status chip's own pair clears AA", () => {
    for (const hue of ["blue", "green", "red"]) {
      const fg = resolve(token(`--color-${hue}-foreground`, "dark"), "dark");
      const bg = resolve(token(`--color-${hue}-background`, "dark"), "dark");
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(AA_BODY);
    }
  });

  it("a control has its own ground — --lb-field must not equal --lb-surface", () => {
    // They were the same token in dark: 1.00:1, so a select read as text.
    const field = resolve(token("--lb-field", "dark"), "dark");
    expect(contrast(field, surface())).toBeGreaterThan(1);
  });

  it("the control border is visible against its field", () => {
    const border = resolve(token("--lb-control-border", "dark"), "dark");
    const field = resolve(token("--lb-field", "dark"), "dark");
    expect(contrast(border, field)).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });
});

describe("light mode did not regress", () => {
  it("chip and muted text still clear AA", () => {
    const fg = resolve(token("--lb-muted", "light"), "light");
    const chip = resolve(token("--lb-chip-bg", "light"), "light");
    const surface = resolve(token("--lb-surface", "light"), "light");
    expect(contrast(fg, chip)).toBeGreaterThanOrEqual(AA_BODY);
    expect(contrast(fg, surface)).toBeGreaterThanOrEqual(AA_BODY);
  });

  it("the control border is visible (was gray-3 at 1.32:1)", () => {
    const border = resolve(token("--lb-control-border", "light"), "light");
    const field = resolve(token("--lb-field", "light"), "light");
    expect(contrast(border, field)).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });
});

describe("state is never carried by colour alone", () => {
  it("each button state adds a glyph, not just a hue", () => {
    for (const state of ["loading", "success", "error", "unavailable"]) {
      expect(STYLES).toMatch(
        new RegExp(`\\.lb-btn\\[data-lb-state=${state}\\]::after\\{content:`),
      );
    }
  });

  it("message tones add a glyph too", () => {
    expect(STYLES).toMatch(/\.lb-msg\[data-tone=error\]::before\{content:/);
    expect(STYLES).toMatch(/\.lb-msg\[data-tone=ok\]::before\{content:/);
  });

  it("forced colours keeps controls distinguishable", () => {
    expect(STYLES).toContain("@media(forced-colors:active)");
    expect(STYLES).toContain("CanvasText");
    expect(STYLES).toContain("Highlight");
  });
});

describe("reduced motion still shows a busy state", () => {
  it("the spinner pulses rather than freezing", () => {
    // animation:none left a static ring — "sending" looked like "cannot click".
    const block = STYLES.slice(STYLES.indexOf("@media(prefers-reduced-motion:reduce)"));
    expect(block).not.toContain(".lb-spinner{animation:none}");
    expect(block).toContain("lb-pulse");
    expect(STYLES).toContain("@keyframes lb-pulse");
  });
});

describe("long unbroken values cannot escape the card", () => {
  it("title and sub break words", () => {
    // An email has no break opportunity; without this it overflows and the
    // chat host clips the tail with no way to recover it.
    expect(STYLES).toMatch(/\.lb-title\{[^}]*overflow-wrap:break-word/s);
    expect(STYLES).toMatch(/\.lb-sub\{[^}]*overflow-wrap:break-word/s);
  });

  it("an empty fact line collapses instead of leaving a void", () => {
    expect(STYLES).toContain(".lb-sub:empty{display:none}");
  });

  it("prose is measure-capped", () => {
    expect(STYLES).toMatch(/\.lb-sub\{[^}]*max-width:68ch/s);
  });
});

describe("visually-hidden helper exists for the labels the contract mandates", () => {
  it("declares .lb-vh", () => {
    expect(STYLES).toContain(".lb-vh{");
    expect(STYLES).toContain("clip-path:inset(50%)");
  });
});

// ── Layout ──────────────────────────────────────────────────────────────────
// The card's six children shared one 12px gap, so nothing grouped; the head
// could not wrap, so a long name was crushed by the chips; and the trailing
// link was anchored only by a spacer, which stops working the moment the row
// wraps — the exact width range a chat host uses.

describe("card layout groups by space", () => {
  it("facts are one tight group, distinct from the card's own gap", () => {
    // Inter-group must be >= 2x intra-group or the grouping reads as noise.
    expect(STYLES).toContain(".lb-facts{display:grid;gap:0.25rem}");
    expect(STYLES).toContain("--lb-gap:0.75rem");
  });

  it("the why line is differentiated by the sheet, not by an inline style", () => {
    expect(STYLES).toContain(".lb-sub[data-why]{font-style:italic");
  });

  it("a fact glyph gets its own column so wrapped lines share one text edge", () => {
    expect(STYLES).toContain(".lb-fact{display:grid;grid-template-columns:1.15rem 1fr");
  });
});

describe("card layout survives a narrow host", () => {
  it("the head wraps and the title outranks the chips", () => {
    // Both children default to flex:0 1 auto and shrink together; without a
    // basis the title is crushed to 3 lines while the chips keep full width.
    expect(STYLES).toMatch(/\.lb-card-head\{[^}]*flex-wrap:wrap/s);
    expect(STYLES).toMatch(/\.lb-title\{[^}]*flex:1 1 11rem/s);
  });

  it("the trailing link re-anchors on whatever line it lands on", () => {
    // A spacer only aligns items on its OWN flex line. .lb-row wraps.
    expect(STYLES).toContain(".lb-row>.lb-link-out{margin-inline-start:auto}");
  });
});

describe("direction-dependent layout is logical, not physical", () => {
  it("uses no physical margin/padding sides", () => {
    for (const p of ["margin-left", "margin-right", "padding-left", "padding-right"]) {
      expect(STYLES).not.toContain(p);
    }
  });

  it("aligns to the start edge, not the left one", () => {
    expect(STYLES).not.toContain("text-align:left");
    expect(STYLES).toContain("text-align:start");
  });
});

describe("the action row is grouped, and the commit is distinguishable", () => {
  it("provides a control-group primitive with a tighter gap than the row", () => {
    // 0.375rem inside a group vs 0.75rem between groups — the 2x rule applied
    // horizontally, so the row reads as "taste | status | inspect" rather than
    // five equal peers.
    expect(STYLES).toContain(".lb-group{display:inline-flex");
    expect(STYLES).toMatch(/\.lb-group\{[^}]*gap:0\.375rem/s);
  });

  it("gives the submit its own treatment by INVERTING, not recolouring", () => {
    // Like/Dislike are independent toggles; "Set status" commits the value in
    // the select beside it. Identical styling hides which control ends the task.
    // The submit swaps --lb-fg and --lb-field rather than introducing a hue, so
    // it themes for free and never competes with the semantic state colours.
    expect(STYLES).toContain(".lb-btn-submit{background-color:var(--lb-fg);color:var(--lb-field)");
    // no new hue: the variant must not reach for a semantic token
    const rule = STYLES.slice(STYLES.indexOf(".lb-btn-submit{"), STYLES.indexOf(".lb-group{"));
    for (const hue of ["blue", "green", "red", "gold", "cherry"]) {
      expect(rule).not.toContain(`--color-${hue}-foreground`);
    }
  });

  it("keeps a wrapped row legible", () => {
    expect(STYLES).toMatch(/\.lb-row\{row-gap:0\.5rem\}/);
  });
});

describe("icon buttons", () => {
  it("are square and keep the row's baseline", () => {
    expect(STYLES).toMatch(/\.lb-btn-icon\{[^}]*width:2\.125rem/s);
    expect(STYLES).toMatch(/\.lb-btn-icon\{[^}]*padding:0/s);
  });

  it("reflect a toggle through aria-pressed, not colour alone", () => {
    // The taste chip carries the durable fact; aria-pressed is the accessible
    // half of the control reflecting it.
    expect(STYLES).toContain(".lb-btn-icon[aria-pressed=true]");
    expect(STYLES).toContain('[data-taste=disliked][aria-pressed=true]');
  });

  it("suppress the trailing state glyph that would push the icon off-centre", () => {
    expect(STYLES).toContain('.lb-btn-icon::after{content:none!important}');
  });

  it("extend the hit target past the 34px box", () => {
    // A glyph-only control has no text to widen its target.
    expect(STYLES).toMatch(/\.lb-btn-icon::before\{content:"";position:absolute;inset:-5px\}/);
  });

  it("the contract demands the three attributes an icon-only control needs", () => {
    const flat = GUIDE_TEXT.replace(/\s+/g, " ");
    expect(flat).toMatch(/aria-label` naming the lead/i);
    expect(flat).toMatch(/`title` so a sighted user/i);
    expect(flat).toMatch(/`aria-pressed` reflecting the current taste/i);
    // and warns where icons do NOT work
    expect(flat).toMatch(/Do \*\*not\*\* reduce "Set status" to an icon/i);
  });
});

describe("the like control is a heart", () => {
  it("fills when pressed — a hollow heart does not read as liked", () => {
    expect(STYLES).toContain(".lb-btn-icon[aria-pressed=true] svg{fill:currentColor}");
  });

  it("the contract ships the heart path, not a thumb", () => {
    // A heart also matches --color-red-like, the frontend's own like colour.
    expect(GUIDE_TEXT).toContain("M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3");
    expect(GUIDE_TEXT).not.toContain('<path d="M7 10v12"/>');
  });
});

describe("save-on-change: the select carries the write", () => {
  it("styles loading and success on the select, not only error", () => {
    // With no submit button the select is the sole affordance — a silent one
    // leaves the rep unsure whether the pick landed.
    expect(STYLES).toContain(".lb-select[data-lb-state=loading]");
    expect(STYLES).toContain(".lb-select[data-lb-state=success]");
    expect(STYLES).toContain(".lb-select[data-lb-state=error]");
  });

  it("the contract makes save-on-change the default and says why", () => {
    const flat = GUIDE_TEXT.replace(/\s+/g, " ");
    expect(flat).toMatch(/Save on change is the default for status/i);
    expect(flat).toMatch(/the select IS the feedback surface/i);
    // and names the one case that still warrants a submit
    expect(flat).toMatch(/Keep a submit button ONLY where a mis-click is expensive/i);
  });
});
