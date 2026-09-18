import { describe, it, expect, beforeEach } from "vitest";
import { lb, configure } from "../src/runtime.js";
import { STYLES } from "../src/styles.js";
import { ARTIFACT_USAGE_GUIDE as GUIDE } from "../../core/src/artifact-runtime.generated.js";

// lb.leadList has always been a paginated model, but nothing told an agent to
// render controls for it — so every board shipped page 0 and silently hid the
// rest of the lens. A 60-lead lens rendered as "5 leads" with no way forward.

const css = STYLES.replace(/\s+/g, " ");
const flat = GUIDE.replace(/\s+/g, " ");

function pagedCall(total: number, pageSize: number) {
  return (_tool: string, args: Record<string, unknown>) => {
    const page = Number(args.page ?? 0);
    const from = page * pageSize;
    const leads = Array.from({ length: Math.max(0, Math.min(pageSize, total - from)) }, (_, i) => ({
      id: `lead-${from + i}`,
    }));
    return Promise.resolve({ leads, pagination: { total } });
  };
}

describe("the list model paginates", () => {
  beforeEach(() => configure({}));

  it("reports an accurate range and hasMore across the whole lens", async () => {
    configure({ call: pagedCall(60, 20) });
    const list = lb.leadList({ ask: "pull me leads", pageSize: 20 });
    await new Promise((r) => setTimeout(r, 0));

    expect(list.total).toBe(60);
    expect(list.items).toHaveLength(20);
    expect(list.page).toBe(0);
    expect(list.hasMore).toBe(true);

    await list.next();
    expect(list.page).toBe(1);
    expect(list.hasMore).toBe(true);

    await list.next();
    expect(list.page).toBe(2);
    // Last page is FULL but there is nothing after it — a Next that fetches
    // nothing is the bug this guards.
    expect(list.hasMore).toBe(false);
  });

  it("prev() never walks before page 0", async () => {
    configure({ call: pagedCall(60, 20) });
    const list = lb.leadList({ ask: "pull me leads", pageSize: 20 });
    await new Promise((r) => setTimeout(r, 0));
    await list.prev();
    expect(list.page).toBe(0);
  });

  it("a partial last page still ends the list", async () => {
    configure({ call: pagedCall(45, 20) });
    const list = lb.leadList({ ask: "pull me leads", pageSize: 20 });
    await new Promise((r) => setTimeout(r, 0));
    await list.loadPage(2);
    expect(list.items).toHaveLength(5);
    expect(list.hasMore).toBe(false);
  });

  it("a single-page lens reports no more pages", async () => {
    configure({ call: pagedCall(5, 20) });
    const list = lb.leadList({ ask: "pull me leads", pageSize: 20 });
    await new Promise((r) => setTimeout(r, 0));
    expect(list.hasMore).toBe(false);
    expect(list.total).toBe(5);
  });

  it("a rapid page flip keeps only the latest result", async () => {
    // Otherwise a slow page 1 lands after a fast page 2 and the deck shows the
    // wrong rows under the right page number.
    const delays: Record<number, number> = { 1: 30, 2: 0 };
    configure({
      call: (_t, args) => {
        const page = Number(args.page ?? 0);
        return new Promise((res) =>
          setTimeout(
            () => res({ leads: [{ id: `page-${page}` }], pagination: { total: 60 } }),
            delays[page] ?? 0,
          ),
        );
      },
    });
    const list = lb.leadList({ ask: "pull me leads", pageSize: 20, autoLoad: false });
    const slow = list.loadPage(1);
    const fast = list.loadPage(2);
    await Promise.all([slow, fast]);
    expect(list.page).toBe(2);
    expect((list.items[0] as { id: string }).id).toBe("page-2");
  });
});

describe("the skin ships the pager", () => {
  it("lays the pager out with a trailing range", () => {
    expect(css).toMatch(/\.lb-pager\{display:flex;align-items:center;gap:0\.75rem/);
    expect(css).toMatch(/\.lb-pager \.lb-spacer\{flex:1 1 auto\}/);
  });

  it("makes the range tabular so the digits do not jitter", () => {
    expect(css).toMatch(/\.lb-pager-range\{[^}]*font-variant-numeric:tabular-nums/);
  });

  it("dims the deck on a page flip rather than blanking it", () => {
    // Blanking loses the scroll position and the rep's sense of place.
    expect(css).toMatch(/\.lb-deck\[data-lb-state=loading\]\{opacity:\.55;pointer-events:none\}/);
  });
});

describe("the recipe documents pagination", () => {
  it("names the model's pagination surface", () => {
    for (const api of [".hasMore", ".next()", ".prev()", ".loadPage(n)"]) {
      expect(flat).toContain(api);
    }
  });

  it("requires a range rather than a bare page number", () => {
    expect(flat).toMatch(/A range, not a page number/i);
    expect(flat).toMatch(/21–40 of 60/);
  });

  it("warns that the last page can be full", () => {
    expect(flat).toMatch(/false on the last page even when\s*that page is full/i);
  });

  it("states what happens to a selection across a page flip", () => {
    // Silently dropping it makes a bulk apply write fewer leads than ticked.
    expect(flat).toMatch(/Selection and page are independent/i);
    expect(flat).toMatch(/writes fewer leads than\s*the rep ticked/i);
  });

  it("says sorting resets to page 0", () => {
    expect(flat).toMatch(/Changing the sort resets to page 0/i);
  });
});
