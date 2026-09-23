import { describe, it, expect, beforeEach } from "vitest";
import { lb, configure } from "../src/runtime.js";
import { ARTIFACT_USAGE_GUIDE as GUIDE } from "../../core/src/artifact-runtime.generated.js";

// product#4215. One account's board built a tab per lens and every lb.leadList
// read page 0 the moment it was constructed, so opening the board read his
// whole book: 21 lenses, 42 pull_leads, 2 MB, 32 seconds — for the one lens he
// then looked at. Session 7c344b6a762a on 2026-09-04 paid it 14 times, once per
// render, plus 632 kB + 469 kB of pull_followups each time.
//
// A list an artifact has not shown must be constructible without reading.

const flat = GUIDE.replace(/\s+/g, " ");

const LENSES = Array.from({ length: 21 }, (_, i) => ({ id: i + 1 }));

function recorder() {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    call: (tool: string, args: Record<string, unknown>) => {
      calls.push({ tool, args });
      return Promise.resolve({ leads: [{ id: `${tool}-lead` }], pagination: { total: 1 } });
    },
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("a board defers the lenses the rep has not opened", () => {
  beforeEach(() => configure({}));

  it("constructs 21 per-lens lists and reads only the visible one", async () => {
    const rec = recorder();
    configure({ call: rec.call });

    const active = LENSES[0].id;
    const lists = LENSES.map((l) =>
      lb.leadList({ lensId: l.id, ask: "ouverture de la mission", autoLoad: l.id === active }),
    );
    await settle();

    expect(rec.calls).toHaveLength(1);
    expect(rec.calls[0].tool).toBe("leadbay_pull_leads");
    expect(rec.calls[0].args.lensId).toBe(active);
    expect(lists[0].items).toHaveLength(1);
    expect(lists[5].items).toHaveLength(0);
  });

  it("reads a deferred lens when the rep opens its tab", async () => {
    const rec = recorder();
    configure({ call: rec.call });

    const list = lb.leadList({ lensId: 7, ask: "ouverture de la mission", autoLoad: false });
    await settle();
    expect(rec.calls).toHaveLength(0);

    await list.loadPage(0);
    expect(rec.calls).toHaveLength(1);
    expect(rec.calls[0].args.lensId).toBe(7);
    expect(list.items).toHaveLength(1);
  });

  it("defers a followups call list too", async () => {
    const rec = recorder();
    configure({ call: rec.call });

    const list = lb.callList({ source: "followups", ask: "la pile des prospects", autoLoad: false });
    await settle();
    expect(rec.calls).toHaveLength(0);

    await list.loadPage(0);
    expect(rec.calls.map((c) => c.tool)).toEqual(["leadbay_pull_followups"]);
  });

  it("still reads on construction when autoLoad is not passed", async () => {
    const rec = recorder();
    configure({ call: rec.call });

    lb.leadList({ lensId: 3, ask: "ouverture de la mission" });
    lb.callList({ source: "followups", ask: "la pile des prospects" });
    await settle();

    expect(rec.calls.map((c) => c.tool)).toEqual([
      "leadbay_pull_leads",
      "leadbay_pull_followups",
    ]);
  });

  it("the guide tells the agent to load only the list on screen", () => {
    expect(flat).toContain("One list loads on open — the one the rep is looking at.");
    expect(flat).toContain("autoLoad: l.id === activeLensId");
    expect(flat).toContain("`lb.callList` takes `autoLoad` too.");
  });
});
