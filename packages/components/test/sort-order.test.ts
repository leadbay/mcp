import { describe, it, expect, beforeEach } from "vitest";
import { lb, configure } from "../src/runtime.js";

// lb.sortOrder + callList's `order` threading. Mirrors the web app's TableSort:
// values are the backend's FIELD:ASC|DESC LeadOrder strings.

const tick = () => new Promise((r) => setTimeout(r, 0));

let calls: Array<{ tool: string; args: Record<string, unknown> }>;

beforeEach(() => {
  configure({});
  calls = [];
  delete (globalThis as { cowork?: unknown }).cowork;
});

function stubList() {
  calls = [];
  configure({
    call: async (tool, args) => {
      calls.push({ tool, args });
      return { leads: [{ id: "a", name: "Acme" }], total_leads: 1 };
    },
  });
}

describe("lb.sortOrder", () => {
  it("opens on the default ranking, not a sort", async () => {
    const f = lb.sortOrder();
    await tick();
    // An empty value means "send no order param" — the Monitor's own ranking,
    // which is what a rep working a list top-down expects.
    expect(f.value).toBe("");
    expect(f.options[0].value).toBe("");
    expect(f.options[0].label).toBe("Default ranking");
  });

  it("offers FIELD:ASC|DESC values matching the backend LeadOrder enum", async () => {
    const f = lb.sortOrder();
    await tick();
    const values = f.options.map((o) => String(o.value)).filter(Boolean);
    expect(values).toContain("SCORE:DESC");
    expect(values).toContain("NAME:ASC");
    expect(values).toContain("LAST_PROSPECTING_ACTION_AT:DESC");
    // every non-empty value is FIELD:DIRECTION
    for (const v of values) expect(v).toMatch(/^[A-Z_]+:(ASC|DESC)$/);
  });

  it("seeds from a current value, case-insensitively", async () => {
    const f = lb.sortOrder("name:asc");
    await tick();
    expect(f.value).toBe("NAME:ASC");
  });

  it("falls back to the default when handed an unknown order", async () => {
    const f = lb.sortOrder("BOGUS:ASC");
    await tick();
    expect(f.value).toBe("");
  });
});

describe("callList order threading", () => {
  it("omits `order` entirely when no sort is chosen", async () => {
    stubList();
    const order = lb.sortOrder();
    await tick();
    lb.callList({ source: "followups", ask: "x", order });
    await tick();

    expect(calls[0].tool).toBe("leadbay_pull_followups");
    expect("order" in calls[0].args).toBe(false);
  });

  it("sends the chosen order", async () => {
    stubList();
    const order = lb.sortOrder("NAME:ASC");
    await tick();
    lb.callList({ source: "followups", ask: "x", order });
    await tick();

    expect(calls[0].args.order).toBe("NAME:ASC");
  });

  it("reads the field at request time, so re-sorting needs no rebuild", async () => {
    stubList();
    const order = lb.sortOrder();
    await tick();
    const list = lb.callList({ source: "followups", ask: "x", order });
    await tick();
    expect("order" in calls[0].args).toBe(false);

    order.setValue("SCORE:ASC");
    await list.loadPage(0);
    expect(calls[calls.length - 1].args.order).toBe("SCORE:ASC");
  });

  it("accepts a literal string too", async () => {
    stubList();
    lb.callList({ source: "followups", ask: "x", order: "SIZE:DESC" });
    await tick();
    expect(calls[0].args.order).toBe("SIZE:DESC");
  });

  it("does not send order to a campaign call sheet — that tool has no such param", async () => {
    stubList();
    const order = lb.sortOrder("NAME:ASC");
    await tick();
    lb.callList({ source: "campaign", campaignId: "c1", ask: "x", order });
    await tick();

    expect(calls[0].tool).toBe("leadbay_campaign_call_sheet");
    expect("order" in calls[0].args).toBe(false);
  });
});

describe("lb.leadList — sortable Discover batch", () => {
  it("omits `order` when no sort is chosen", async () => {
    stubList();
    const order = lb.sortOrder();
    await tick();
    lb.leadList({ ask: "x", order });
    await tick();

    expect(calls[0].tool).toBe("leadbay_pull_leads");
    expect("order" in calls[0].args).toBe(false);
  });

  it("sends the chosen order to pull_leads", async () => {
    stubList();
    const order = lb.sortOrder("SCORE:ASC");
    await tick();
    lb.leadList({ ask: "x", order });
    await tick();

    expect(calls[0].args.order).toBe("SCORE:ASC");
  });

  it("passes lensId through when pinned", async () => {
    stubList();
    lb.leadList({ ask: "x", lensId: 4666, order: "NAME:ASC" });
    await tick();

    expect(calls[0].args.lensId).toBe(4666);
    expect(calls[0].args.order).toBe("NAME:ASC");
  });

  it("re-sorts on loadPage without rebuilding the view-model", async () => {
    stubList();
    const order = lb.sortOrder();
    await tick();
    const list = lb.leadList({ ask: "x", order });
    await tick();

    order.setValue("SIZE:DESC");
    await list.loadPage(0);
    expect(calls[calls.length - 1].args.order).toBe("SIZE:DESC");
  });
});
