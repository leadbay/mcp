import { describe, it, expect } from "vitest";
import { lb } from "../src/runtime.js";
import { ARTIFACT_USAGE_GUIDE as GUIDE } from "../../core/src/artifact-runtime.generated.js";

// The library renders nothing by default — the artifact owns its markup. These
// three are the exception, because the manager dashboard proved each of them
// goes wrong the same way in every hand-rolled copy: SVG points escaping the
// viewBox, empty axes drawn for an empty series, digits that do not line up.

const flat = GUIDE.replace(/\s+/g, " ");
const W = 640, H = 160;

describe("lb.sparkline", () => {
  const series = [
    { date: "2026-06-24", count: 4 },
    { date: "2026-07-01", count: 11 },
    { date: "2026-07-08", count: 18 },
  ];

  it("draws one dot per point, with a line and an area", () => {
    const svg = lb.sparkline(series) as SVGElement;
    expect(svg.tagName.toLowerCase()).toBe("svg");
    expect(svg.querySelectorAll(".lb-chart-dot")).toHaveLength(3);
    expect(svg.querySelector(".lb-chart-line")).not.toBeNull();
    expect(svg.querySelector(".lb-chart-area")).not.toBeNull();
  });

  it("keeps every drawn point inside the viewBox", () => {
    // The bug this exists to prevent: a peak that clips off the top, or a
    // first point sitting under the y-axis labels.
    const svg = lb.sparkline(series) as SVGElement;
    for (const c of svg.querySelectorAll(".lb-chart-dot")) {
      const cx = Number(c.getAttribute("cx"));
      const cy = Number(c.getAttribute("cy"));
      expect(cx).toBeGreaterThanOrEqual(0);
      expect(cx).toBeLessThanOrEqual(W);
      expect(cy).toBeGreaterThanOrEqual(0);
      expect(cy).toBeLessThanOrEqual(H);
    }
  });

  it("returns the empty block — not empty axes — for an empty series", () => {
    for (const empty of [[], null, undefined]) {
      const node = lb.sparkline(empty as never, { emptyTitle: "No activity" }) as HTMLElement;
      expect(node.className).toBe("lb-empty");
      expect(node.textContent).toContain("No activity");
      expect(node.querySelector("svg")).toBeNull();
    }
  });

  it("carries the hint when one is given", () => {
    const node = lb.sparkline([], { emptyTitle: "t", emptyHint: "widen the window" }) as HTMLElement;
    expect(node.querySelector(".lb-empty-hint")?.textContent).toBe("widen the window");
  });

  it("is labelled for a screen reader", () => {
    const svg = lb.sparkline(series, { label: "Activity, June to July" }) as SVGElement;
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("Activity, June to July");
  });

  it("centres a single point rather than dividing by zero", () => {
    const svg = lb.sparkline([{ date: "2026-07-01", count: 5 }]) as SVGElement;
    const cx = Number(svg.querySelector(".lb-chart-dot")!.getAttribute("cx"));
    expect(Number.isFinite(cx)).toBe(true);
    expect(cx).toBeGreaterThan(0);
    expect(cx).toBeLessThan(W);
  });

  it("survives an all-zero series without collapsing the scale", () => {
    const svg = lb.sparkline([{ count: 0 }, { count: 0 }]) as SVGElement;
    for (const c of svg.querySelectorAll(".lb-chart-dot")) {
      expect(Number.isFinite(Number(c.getAttribute("cy")))).toBe(true);
    }
  });

  it("ignores a non-numeric count instead of drawing NaN", () => {
    const svg = lb.sparkline([{ count: "oops" as never }, { count: 4 }]) as SVGElement;
    const d = svg.querySelector(".lb-chart-line")!.getAttribute("d")!;
    expect(d).not.toMatch(/NaN/);
  });
});

describe("lb.tiles", () => {
  it("renders a label and a value per tile", () => {
    const node = lb.tiles([{ label: "Activities", value: 48 }, { label: "Meetings", value: 6 }]);
    expect(node.className).toBe("lb-tiles");
    expect(node.querySelectorAll(".lb-tile")).toHaveLength(2);
    expect(node.querySelector(".lb-tile-label")?.textContent).toBe("Activities");
    expect(node.querySelector(".lb-tile-value")?.textContent).toBe("48");
  });
});

describe("lb.leaderboard", () => {
  const rows = [
    { name: "alex", email: "a@x.com", total_activities: 31, lost: 1 },
    { name: "damien", email: "d@x.com", total_activities: 48, lost: 3 },
  ];
  const columns = [
    { key: "name", label: "Rep" },
    { key: "total_activities", label: "Activities", num: true },
    { key: "lost", label: "Lost", num: true },
  ];

  it("sorts descending on the given key by default", () => {
    const node = lb.leaderboard({ rows, columns, sortKey: "total_activities" });
    const first = node.querySelector("tbody tr td")!.textContent;
    expect(first).toBe("damien");
  });

  it("marks the sorted column with aria-sort, others none", () => {
    const node = lb.leaderboard({ rows, columns, sortKey: "total_activities" });
    const ths = [...node.querySelectorAll("th")];
    expect(ths[1].getAttribute("aria-sort")).toBe("descending");
    expect(ths[0].getAttribute("aria-sort")).toBe("none");
  });

  it("toggles direction when the same header is clicked twice", () => {
    const node = lb.leaderboard({ rows, columns, sortKey: "total_activities" });
    const th = node.querySelectorAll("th")[1] as HTMLElement;
    th.click();
    expect(node.querySelectorAll("th")[1].getAttribute("aria-sort")).toBe("ascending");
    expect(node.querySelector("tbody tr td")!.textContent).toBe("alex");
  });

  it("is keyboard operable, not mouse-only", () => {
    const node = lb.leaderboard({ rows, columns, sortKey: "total_activities" });
    const th = node.querySelectorAll("th")[1] as HTMLElement;
    expect(th.getAttribute("tabindex")).toBe("0");
    th.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(node.querySelectorAll("th")[1].getAttribute("aria-sort")).toBe("ascending");
  });

  it("marks numeric cells so a column can be scanned down", () => {
    const node = lb.leaderboard({ rows, columns });
    expect(node.querySelectorAll("td[data-num]")).toHaveLength(4);
  });

  it("lets a column render its own cell", () => {
    const node = lb.leaderboard({
      rows,
      columns: [
        { key: "name", label: "Rep", cell: (r) => {
            const a = document.createElement("a");
            a.href = `mailto:${r.email}`;
            a.textContent = String(r.name);
            return a;
          } },
      ],
    });
    const a = node.querySelector("td a") as HTMLAnchorElement;
    expect(a.getAttribute("href")).toMatch(/^mailto:/);
  });

  it("returns the empty block for no rows", () => {
    const node = lb.leaderboard({ rows: [], columns, emptyTitle: "No reps" });
    expect(node.className).toBe("lb-empty");
    expect(node.textContent).toContain("No reps");
  });

  it("scrolls in its own container, never the page body", () => {
    const node = lb.leaderboard({ rows, columns });
    expect(node.style.overflowX).toBe("auto");
    expect(node.querySelector("table.lb-table")).not.toBeNull();
  });
});

describe("the guide documents the helpers", () => {
  it("lists all three with their contracts", () => {
    for (const api of ["lb.sparkline(", "lb.tiles(", "lb.leaderboard("]) {
      expect(flat).toContain(api);
    }
  });

  it("says they return a detached element the caller places", () => {
    expect(flat).toMatch(/Each returns a DETACHED element you\s*place; none injects itself/i);
  });

  it("explains why these three and nothing else", () => {
    expect(flat).toMatch(/hand-rolling them goes wrong the same way every time/i);
  });
});
