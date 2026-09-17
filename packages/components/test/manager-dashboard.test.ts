import { describe, it, expect, beforeEach } from "vitest";
import { lb, configure } from "../src/runtime.js";
import { STYLES } from "../src/styles.js";
import { ARTIFACT_USAGE_GUIDE as GUIDE } from "../../core/src/artifact-runtime.generated.js";

// A manager dashboard reports before it lists: figures, the trend behind them,
// then the per-rep table. The kit shipped teamActivity but nothing to render it
// with, so every dashboard hand-rolled its own chart — and a hardcoded stroke
// disappears in whichever theme it was not written for.
//
// The empty window is the case that matters most: a real FR account returned
// one rep, every count 0, and `trend: []`. A dashboard that only handles
// populated data renders empty axes there and reads as broken.

const css = STYLES.replace(/\s+/g, " ");
const flat = GUIDE.replace(/\s+/g, " ");

describe("the skin ships the dashboard surfaces", () => {
  it("tiles are a responsive row that collapses on a phone", () => {
    expect(css).toMatch(/\.lb-tiles\{display:grid[^}]*minmax\(min\(9rem,100%\),1fr\)\)/);
  });

  it("a tile's value is tabular, so a changing figure does not shift the row", () => {
    expect(css).toMatch(/\.lb-tile-value\{[^}]*font-variant-numeric:tabular-nums/);
  });

  it("the chart takes every colour from the theme, never a literal", () => {
    // A hardcoded stroke reads in one theme and vanishes in the other.
    expect(css).toMatch(/\.lb-chart \.lb-chart-line\{[^}]*stroke:var\(--color-blue-foreground\)/);
    expect(css).toMatch(/\.lb-chart \.lb-chart-area\{fill:var\(--color-blue-background\)/);
    expect(css).toMatch(/\.lb-chart \.lb-chart-grid\{stroke:var\(--lb-border\)/);
    expect(css).toMatch(/\.lb-chart text\{fill:var\(--lb-muted\)/);
    const chartBlock = css.match(/\.lb-chart[^{]*\{[^}]*\}/g)?.join(" ") ?? "";
    expect(chartBlock).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it("the chart scales with its container rather than a fixed width", () => {
    expect(css).toMatch(/\.lb-chart\{display:block;width:100%;height:auto\}/);
  });

  it("ships an empty state with room for a hint", () => {
    expect(css).toMatch(/\.lb-empty\{[^}]*border:1px dashed/);
    expect(css).toMatch(/\.lb-empty-hint\{[^}]*max-width:44ch/);
  });

  it("numeric table cells are tabular and end-aligned", () => {
    expect(css).toMatch(/\.lb-table td\[data-num\],\.lb-table th\[data-num\]\{text-align:end;\s*font-variant-numeric:tabular-nums\}/);
  });

  it("a sortable header carries direction in aria-sort, not only an arrow", () => {
    expect(css).toMatch(/\.lb-table th\[aria-sort\]\{cursor:pointer/);
    expect(css).toMatch(/th\[aria-sort=ascending\]::after\{content:/);
    expect(css).toMatch(/th\[aria-sort=descending\]::after\{content:/);
    expect(css).toMatch(/th\[aria-sort=none\]::after\{content:/);
  });

  it("every dashboard selector stays lb- scoped", () => {
    const classes = STYLES.match(/\.[a-zA-Z][\w-]*/g) ?? [];
    expect([...new Set(classes)].filter((c) => !c.startsWith(".lb-"))).toEqual([]);
  });
});

describe("teamActivity feeds it", () => {
  beforeEach(() => configure({}));

  it("passes the window through and returns range, reps and trend", async () => {
    let seen: Record<string, unknown> = {};
    configure({
      call: (_t, args) => {
        seen = args;
        return Promise.resolve({
          range: { from: "2026-06-24", to: "2026-09-16", periodicity: "WEEKLY" },
          reps: [{ user_id: "u1", name: "damien", total_activities: 0 }],
          trend: [],
        });
      },
    });
    const team = lb.teamActivity({ weeks: 12, ask: "rebuild the manager dashboard" });
    await new Promise((r) => setTimeout(r, 0));

    expect(seen.weeks).toBe(12);
    expect(seen._triggered_by).toBe("rebuild the manager dashboard");
    const d = team.data as { reps: unknown[]; trend: unknown[] };
    expect(d.reps).toHaveLength(1);
    expect(d.trend).toEqual([]);
  });

  it("an all-zero team with no trend is data, not an error", async () => {
    // The shape a real FR account returned. It must not surface as a failure.
    configure({
      call: () => Promise.resolve({ range: {}, reps: [{ user_id: "u1", total_activities: 0 }], trend: [] }),
    });
    const team = lb.teamActivity({ ask: "rebuild the manager dashboard" });
    await new Promise((r) => setTimeout(r, 0));
    expect(team.error).toBeNull();
    expect(team.data).not.toBeNull();
  });
});

describe("the recipe documents the dashboard", () => {
  it("names the classes it needs", () => {
    for (const cls of ["lb-tiles", "lb-tile-value", "lb-chart", "lb-empty", "data-num", "aria-sort"]) {
      expect(flat).toContain(cls);
    }
  });

  it("treats an empty window as a real answer", () => {
    expect(flat).toMatch(/An empty window is a real answer/i);
    expect(flat).toMatch(/never empty axes/i);
  });

  it("says sorting here is client-side, unlike a lead list", () => {
    expect(flat).toMatch(/Sorting is CLIENT-side here/i);
  });

  it("requires the resolved window to be printed", () => {
    expect(flat).toMatch(/what makes the figures\s*auditable/i);
  });

  it("refuses to fake a rep-messaging button", () => {
    // reps[] has email and nothing else; there is no tool that messages a rep.
    expect(flat).toMatch(/Writing to a rep is not in this payload/i);
    expect(flat).toMatch(/do not render a "message" button\s*that silently does nothing/i);
  });
});
