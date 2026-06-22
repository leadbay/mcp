import { describe, it, expect, beforeEach } from "vitest";
import { lb, configure } from "../src/runtime.js";

// The view-model layer added in 0.3.0: resource (load/poll/refresh), list
// (pagination), and the domain factories that bake in tool names + arg shapes +
// the report_outreach / enrichment footguns.

const tick = () => new Promise((r) => setTimeout(r, 0));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  configure({});
  delete (globalThis as { cowork?: unknown }).cowork;
});

describe("lb.resource", () => {
  it("load-on-demand: autoLoad:false does nothing until .load()", async () => {
    let n = 0;
    const r = lb.resource({ autoLoad: false, load: async () => ++n });
    await tick();
    expect(n).toBe(0);
    await r.load();
    expect(n).toBe(1);
    expect(r.data).toBe(1);
    expect(r.done).toBe(true);
  });

  it("polls until the terminal condition, then stops", async () => {
    let n = 0;
    const r = lb.resource({ pollEvery: 5, until: (d: any) => d.done, load: async () => ({ n: ++n, done: n >= 3 }) });
    await sleep(80);
    expect(n).toBe(3);
    expect(r.done).toBe(true);
    await sleep(30);
    expect(n).toBe(3); // stopped — no more polls
  });

  it("first load sets loading; a background poll/refresh sets refreshing instead", async () => {
    let resolve!: (v: unknown) => void;
    const r = lb.resource({ load: () => new Promise((res) => (resolve = res)) });
    await tick();
    expect(r.loading).toBe(true);
    expect(r.refreshing).toBe(false);
    resolve({ a: 1 });
    await tick();
    expect(r.loading).toBe(false);
    expect(r.data).toEqual({ a: 1 });

    void r.refresh();
    await tick();
    expect(r.loading).toBe(false);
    expect(r.refreshing).toBe(true);
    resolve({ a: 2 });
    await tick();
    expect(r.refreshing).toBe(false);
    expect(r.data).toEqual({ a: 2 });
  });
});

describe("lb.list", () => {
  it("paginates with loadPage / next / prev + hasMore", async () => {
    const pages: Record<number, unknown[]> = { 0: [{ id: 1 }], 1: [{ id: 2 }] };
    const r = lb.list({ pageSize: 1, load: async ({ page }) => ({ items: pages[page] ?? [], total: 2 }) });
    await tick();
    expect(r.items).toEqual([{ id: 1 }]);
    expect(r.page).toBe(0);
    expect(r.total).toBe(2);
    expect(r.hasMore).toBe(true);
    await r.next();
    expect(r.items).toEqual([{ id: 2 }]);
    expect(r.hasMore).toBe(false);
    await r.prev();
    expect(r.page).toBe(0);
  });
});

describe("request sequencing + value propagation (review hardening)", () => {
  it("resource: a superseded load can't overwrite the latest result", async () => {
    const resolvers: Array<(v: unknown) => void> = [];
    configure({ call: () => new Promise((res) => resolvers.push(res)) });
    const r = lb.resource({ load: () => lb.call("t", {}) }); // autoload → request #0
    await tick();
    void r.refresh(); // request #1
    await tick();
    resolvers[1]({ structuredContent: { v: "new" } }); // newer resolves FIRST
    await tick();
    resolvers[0]({ structuredContent: { v: "old" } }); // older resolves after → must be dropped
    await tick();
    expect(r.data).toEqual({ v: "new" });
  });

  it("list: rapid page flips keep only the latest page", async () => {
    const resolvers: Record<number, (v: unknown) => void> = {};
    const r = lb.list({
      pageSize: 1,
      autoLoad: false,
      load: ({ page }) => new Promise((res) => (resolvers[page] = res)),
    });
    void r.loadPage(1);
    void r.loadPage(2);
    await tick();
    resolvers[2]({ items: [{ id: 2 }], total: 9 }); // newer first
    await tick();
    resolvers[1]({ items: [{ id: 1 }], total: 9 }); // stale → dropped
    await tick();
    expect(r.page).toBe(2);
    expect(r.items).toEqual([{ id: 2 }]);
  });

  it("field: defaulting value to the first option notifies dependsOn dependents", async () => {
    const seen: unknown[] = [];
    const parent = lb.field({
      load: () => Promise.resolve([{ value: "p1", label: "P1" }, { value: "p2", label: "P2" }]),
    });
    lb.field({
      dependsOn: [parent],
      load: () => {
        seen.push(parent.value);
        return Promise.resolve([]);
      },
    });
    await tick();
    // parent's load defaults its value "" → "p1" and emits, so the dependent reloads
    // seeing the defaulted value (the bug was a silent mutation that skipped this).
    expect(parent.value).toBe("p1");
    expect(seen).toContain("p1");
  });
});

describe("domain factories", () => {
  it("lb.campaigns populates options (handles nested + flat shapes)", async () => {
    configure({
      call: async (tool, args) => {
        expect(tool).toBe("leadbay_list_campaigns");
        expect(args._triggered_by).toBe("ask");
        return { structuredContent: { campaigns: [{ id: "c1", name: "A" }, { campaign: { id: "c2", name: "B" } }] } };
      },
    });
    const f = lb.campaigns("ask");
    await tick();
    expect(f.options).toEqual([{ value: "c1", label: "A" }, { value: "c2", label: "B" }]);
  });

  it("lb.outreach bakes verification + _triggered_by + epilogue, gated on the note", async () => {
    const calls: Array<{ t: string; a: Record<string, any> }> = [];
    configure({ call: async (t, a) => (calls.push({ t, a }), { ok: true }) });
    const status = lb.field({ value: "INTEREST_VALIDATED_OR_MEETING_PLANED" });
    const note = lb.field({ validate: (v) => (v ? null : "Add a note") });
    const a = lb.outreach({ leadId: "L1", ask: "ASK", status, note, ref: "call sheet" });

    await a.run(); // note empty → blocked
    expect(calls).toHaveLength(0);
    expect(a.error?.message).toBe("Add a note");

    note.setValue("spoke with Jane");
    await a.run();
    expect(calls).toHaveLength(1);
    expect(calls[0].t).toBe("leadbay_report_outreach");
    expect(calls[0].a).toEqual({
      lead_id: "L1",
      epilogue_status: "INTEREST_VALIDATED_OR_MEETING_PLANED",
      note: "spoke with Jane",
      verification: { source: "user_confirmed", ref: "call sheet" },
      _triggered_by: "ASK",
    });
  });

  it("lb.enrichment launches once then polls bulk_enrich_status until all_done", async () => {
    let launches = 0;
    let statusReads = 0;
    configure({
      call: async (t) => {
        if (t === "leadbay_enrich_titles") return (launches++, { bulk_id: "b1" });
        if (t === "leadbay_bulk_enrich_status") {
          statusReads++;
          return { overall_progress: { done: statusReads, total: 2 }, all_done: statusReads >= 2 };
        }
        return {};
      },
    });
    const e = lb.enrichment({ leadIds: ["L1"], titles: ["CEO"], ask: "ASK", pollEvery: 5 });
    await sleep(60);
    expect(launches).toBe(1); // launched exactly once
    expect(statusReads).toBe(2);
    expect(e.done).toBe(true);
    expect((e.data as any).all_done).toBe(true);
  });

  it("lb.enrichment with nothing to enrich resolves terminal (no_job), not error", async () => {
    configure({ call: async (t) => (t === "leadbay_enrich_titles" ? { mode: "preview_only", launched: false } : {}) });
    const e = lb.enrichment({ titles: ["CEO"], ask: "ASK", pollEvery: 5 });
    await tick();
    expect(e.done).toBe(true);
    expect(e.error).toBeNull();
    expect((e.data as any).no_job).toBe(true);
  });

  it("lb.leadHistory is lazy (account_history only on .load())", async () => {
    const calls: string[] = [];
    configure({ call: async (t) => (calls.push(t), { notes: [], activities: { activities: [] } }) });
    const h = lb.leadHistory("L1", "ASK");
    await tick();
    expect(calls).toHaveLength(0);
    await h.load();
    expect(calls).toEqual(["leadbay_account_history"]);
    expect(h.data).toBeTruthy();
  });

  it("lb.teamActivity loads the manager tool with the window", async () => {
    configure({
      call: async (t, a) => {
        expect(t).toBe("leadbay_team_activity");
        expect(a.weeks).toBe(2);
        return { reps: [], trend: [] };
      },
    });
    const ta = lb.teamActivity({ weeks: 2, ask: "ASK" });
    await tick();
    expect(ta.data).toEqual({ reps: [], trend: [] });
  });
});
