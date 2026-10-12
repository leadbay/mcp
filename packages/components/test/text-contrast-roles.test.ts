import { describe, it, expect } from "vitest";
import { STYLES } from "../src/styles.js";

// Coloured TEXT gets its own role tokens (--lb-text-{blue,green,red,teal}).
// The palette is the web app's, verbatim, and its light-mode foregrounds
// (L 0.564) were made for icons and borders: as 12–13px text they measured
// 3.4–4.3:1 on light grounds (the welcome board's interface review). These
// pin the role tokens to AA on every ground they render on, in both themes,
// and pin the skin's text rules to the role tokens rather than the palette.
//
// New file — does not modify dark-mode.test.ts or styles.test.ts. The
// colour maths is the same CSS Color 4 conversion dark-mode.test.ts uses.

const gamma = (t: number) => (t > 0.0031308 ? 1.055 * Math.pow(t, 1 / 2.4) - 0.055 : 12.92 * t);
function oklch(L: number, C: number, H: number): [number, number, number] {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return rgb.map((v) => Math.max(0, Math.min(1, gamma(v)))) as [number, number, number];
}
const hex = (h: string): [number, number, number] =>
  [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (c: [number, number, number]) => 0.2126 * linear(c[0]) + 0.7152 * linear(c[1]) + 0.0722 * linear(c[2]);
const contrast = (a: [number, number, number], b: [number, number, number]) => {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

function token(name: string, block: "light" | "dark"): string {
  const read = (b: "light" | "dark"): string | null => {
    const start = b === "light" ? STYLES.indexOf(":root{") : STYLES.indexOf(":root[data-theme=dark]");
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
const col = (name: string, block: "light" | "dark") => resolve(token(name, block), block);

const AA_BODY = 4.5;
const HUES = ["blue", "green", "red", "teal"] as const;

describe("coloured text clears AA wherever it renders", () => {
  for (const block of ["light", "dark"] as const) {
    it(`${block}: every text role on the card, the page, a field and its own tint`, () => {
      for (const hue of HUES) {
        const fg = col(`--lb-text-${hue}`, block);
        const grounds: Record<string, [number, number, number]> = {
          surface: col("--lb-surface", block),
          page: col("--lb-page-bg", block),
          field: col("--lb-field", block),
          [`${hue} tint`]: col(`--color-${hue}-background`, block),
        };
        for (const [ground, bg] of Object.entries(grounds)) {
          expect(contrast(fg, bg), `${block} --lb-text-${hue} on ${ground}`).toBeGreaterThanOrEqual(AA_BODY);
        }
      }
    });
  }

  it("dark mode reuses the palette as it is, in both dark paths", () => {
    const blocks = STYLES.split("--lb-surface:var(--color-gray-9)").slice(1);
    expect(blocks).toHaveLength(2);
    for (const b of blocks) {
      for (const hue of HUES) expect(b).toContain(`--lb-text-${hue}:var(--color-${hue}-foreground)`);
    }
  });

  it("the web app's palette itself is untouched", () => {
    expect(STYLES).toContain("--color-blue-foreground:oklch(0.564 0.181 251)");
    expect(STYLES).toContain("--color-teal-foreground:oklch(0.574 0.182 180)");
  });
});

describe("the skin colours text with the role tokens, not the palette", () => {
  it("links, status messages, status chips and intent tags", () => {
    expect(STYLES).toMatch(/\.lb-link\{color:var\(--lb-text-blue\)/);
    expect(STYLES).toMatch(/\.lb-msg\[data-tone=ok\]\{color:var\(--lb-text-green\)/);
    expect(STYLES).toMatch(/\.lb-msg\[data-tone=error\]\{color:var\(--lb-text-red\)/);
    expect(STYLES).toMatch(/\.lb-chip\[data-status=WANTED\]\{[^}]*color:var\(--lb-text-blue\)/);
    expect(STYLES).toMatch(/\.lb-tags-intent>\*\{[^}]*color:var\(--lb-text-teal\)/);
  });

  it("no rule paints text straight from a palette foreground", () => {
    // Borders, dots and grounds may; a `color:` declaration may not.
    expect(STYLES).not.toMatch(/(^|[;{\n])color:var\(--color-(blue|green|red|teal)-foreground\)/);
  });
});

describe("a plain button follows the theme", () => {
  it("takes --lb-fg on --lb-field, so dark mode keeps the inverted primary distinct", () => {
    expect(STYLES).toMatch(/\.lb-btn\{[^}]*color:var\(--lb-fg\);background-color:var\(--lb-field\)/);
    const plain = col("--lb-field", "dark");
    const primary = col("--lb-fg", "dark"); // .lb-btn-submit's ground
    expect(contrast(plain, primary)).toBeGreaterThan(10);
  });

  it("a dark hover never puts white text on light grey", () => {
    expect(STYLES).toMatch(/:where\(:root\[data-theme=dark\],:root\[data-lb-theme=dark\]\) \.lb-btn:hover[^{]*\{\s*background-color:var\(--lb-chip-bg\)\}/);
    expect(contrast(col("--lb-fg", "dark"), col("--lb-chip-bg", "dark"))).toBeGreaterThanOrEqual(AA_BODY);
  });

  it("dark muted text stays readable but steps back from the white headings", () => {
    const muted = col("--lb-muted", "dark");
    expect(contrast(muted, col("--lb-chip-bg", "dark"))).toBeGreaterThanOrEqual(AA_BODY);
    expect(contrast(muted, col("--lb-fg", "dark"))).toBeGreaterThan(1.5);
  });
});
