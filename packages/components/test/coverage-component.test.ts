import { describe, it, expect, beforeEach } from "vitest";
import { lb, configure } from "../src/runtime.js";

// lb.coverage — segmentCount generalised from "sector" to any dimension the
// Monitor filter can narrow by (size, recency, liked, yc, custom fields).
//
// The board this replaces was hand-rolled per dimension, and the three things
// it got wrong are the three things this component owns:
//
//   1. PARALLEL SWEEPS. A filtered count is 1–2s normally, but a
//      last_action_date criterion was observed at 54s on a 3.6k segment.
//      Twelve in parallel is a hung page; the sweep is sequential and reports
//      progress.
//   2. DELTA FILTERS. The stored Monitor filter is a single server-side slot
//      and cumulative. Sending bucket B as a delta after bucket A leaves A's
//      criterion in force, so every bar after the first is fenced by the one
//      before it — a chart where each bucket is a subset of its predecessor.
//   3. ONE trusted FLAG FOR THE BOARD. A rejected criterion returns 200 with
//      the PREVIOUS filter applied. Verification has to be per-bucket, or one
//      bad segment silently poisons a neighbour's number.

type Call = { tool: string; args: Record<string, unknown> };

let calls: Call[];

/** Echoes back whatever criteria were sent — the trusted path. */
function stubEchoing(totals: Record<string, number>, deflt = 0) {
  calls = [];
  configure({
    call: async (tool, args) => {
      const a = args as Record<string, any>;
      calls.push({ tool, args: a });
      const criteria = a.set_filter?.criteria ?? [];
      const key = criteria.length === 0 ? "__all__" : JSON.stringify(criteria[0]);
      return {
        pagination: { total: totals[key] ?? deflt },
        active_filters: { criteria },
      };
    },
  });
}

const sizeBucket = (min: number, max: number) => ({
  id: `${min}-${max}`,
  label: `${min}–${max}`,
  criterion: { type: "size", min, max, is_excluded: false },
});

beforeEach(() => {
  configure({});
  delete (globalThis as { cowork?: unknown }).cowork;
});

describe("lb.coverage measures any dimension, not just sector", () => {
  it("counts size bands — a dimension segmentCount could not express", async () => {
    const b1 = sizeBucket(1, 10);
    const b2 = sizeBucket(20, 49);
    stubEchoing({
      [JSON.stringify(b1.criterion)]: 143,
      [JSON.stringify(b2.criterion)]: 3656,
    });
    const rows = await lb.coverage({ buckets: [b1, b2], ask: "size coverage" });
    expect(rows.map((r) => [r.label, r.total, r.trusted])).toEqual([
      ["1–10", 143, true],
      ["20–49", 3656, true],
    ]);
  });

  it("counts a custom field the kit has never heard of", async () => {
    const bucket = {
      id: "tier-a",
      label: "Tier A",
      criterion: { type: "custom_field", key: "tier", value: "A" },
    };
    stubEchoing({ [JSON.stringify(bucket.criterion)]: 12 });
    const [row] = await lb.coverage({ buckets: [bucket], ask: "tiers" });
    expect(row.total).toBe(12);
    expect(row.trusted).toBe(true);
  });
});

describe("the sweep is sequential and sends complete criteria", () => {
  it("issues one call per bucket, in order, never concurrently", async () => {
    const order: string[] = [];
    calls = [];
    let live = 0;
    configure({
      call: async (tool, args) => {
        const a = args as Record<string, any>;
        calls.push({ tool, args: a });
        live++;
        expect(live).toBe(1); // a parallel burst would trip this
        await new Promise((r) => setTimeout(r, 3));
        live--;
        order.push(a.set_filter.criteria[0]?.id ?? "x");
        return { pagination: { total: 1 }, active_filters: { criteria: a.set_filter.criteria } };
      },
    });
    const buckets = ["a", "b", "c"].map((id) => ({
      id,
      label: id,
      criterion: { type: "custom_field", id },
    }));
    await lb.coverage({ buckets, ask: "x" });
    expect(order).toEqual(["a", "b", "c"]);
    expect(calls).toHaveLength(3);
  });

  it("sends ONLY the current bucket's criterion — never a cumulative delta", async () => {
    // The stored filter is one server-side slot. If call 2 carried call 1's
    // criterion too, every bar would be an intersection of its predecessors.
    const b1 = sizeBucket(1, 10);
    const b2 = sizeBucket(20, 49);
    stubEchoing({});
    await lb.coverage({ buckets: [b1, b2], ask: "x" });
    expect((calls[0].args as any).set_filter.criteria).toEqual([b1.criterion]);
    expect((calls[1].args as any).set_filter.criteria).toEqual([b2.criterion]);
  });

  it("reports progress after each bucket, for a visible sweep", async () => {
    stubEchoing({});
    const seen: Array<[number, number]> = [];
    await lb.coverage({
      buckets: [sizeBucket(1, 10), sizeBucket(20, 49)],
      ask: "x",
      onProgress: (done, total) => seen.push([done, total]),
    });
    expect(seen).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it("counts at the requested scope — personal is not silently the org's book", async () => {
    stubEchoing({});
    await lb.coverage({ buckets: [sizeBucket(1, 10)], ask: "x", personal: true });
    expect((calls[0].args as any).personal).toBe(true);
  });
});

describe("verification is per bucket", () => {
  it("a bucket whose criterion was dropped is untrusted, and its neighbours are not", async () => {
    const good = sizeBucket(1, 10);
    const bad = { id: "bad", label: "Bad", criterion: { type: "size", min: 0, max: 0 } };
    calls = [];
    configure({
      call: async (tool, args) => {
        const a = args as Record<string, any>;
        calls.push({ tool, args: a });
        const sent = a.set_filter.criteria;
        // The bad criterion is rejected: 200, previous filter still applied.
        const echoed = sent[0]?.max === 0 ? [good.criterion] : sent;
        return { pagination: { total: 99 }, active_filters: { criteria: echoed } };
      },
    });
    const rows = await lb.coverage({ buckets: [good, bad], ask: "x" });
    expect(rows[0].trusted).toBe(true);
    expect(rows[1].trusted).toBe(false); // the number answers the OTHER question
  });

  it("an unrequested leftover criterion is untrusted too", async () => {
    // Cumulative filter: the count is fenced by something nobody asked for.
    calls = [];
    configure({
      call: async (tool, args) => {
        const a = args as Record<string, any>;
        calls.push({ tool, args: a });
        return {
          pagination: { total: 7 },
          active_filters: {
            criteria: [...a.set_filter.criteria, { type: "location_ids", ids: ["99"] }],
          },
        };
      },
    });
    const [row] = await lb.coverage({ buckets: [sizeBucket(1, 10)], ask: "x" });
    expect(row.trusted).toBe(false);
  });

  it("one failing bucket does not abort the other eleven", async () => {
    let n = 0;
    calls = [];
    configure({
      call: async (tool, args) => {
        const a = args as Record<string, any>;
        calls.push({ tool, args: a });
        if (++n === 1) throw new Error("upstream exploded");
        return { pagination: { total: 5 }, active_filters: { criteria: a.set_filter.criteria } };
      },
    });
    const rows = await lb.coverage({
      buckets: [sizeBucket(1, 10), sizeBucket(20, 49)],
      ask: "x",
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].trusted).toBe(false);
    expect(rows[0].error).toMatch(/exploded/);
    expect(rows[1].total).toBe(5);
    expect(rows[1].trusted).toBe(true);
  });
});

describe("lb.coverageTotal is the unfiltered denominator", () => {
  it("sends no criteria, so it ignores the Monitor tab's own filter", async () => {
    stubEchoing({ __all__: 7078 });
    const row = await lb.coverageTotal({ ask: "x" });
    expect((calls[0].args as any).set_filter.criteria).toEqual([]);
    expect(row.total).toBe(7078);
    expect(row.trusted).toBe(true);
  });

  it("an empty echo is what makes the denominator trustworthy", async () => {
    // With nothing wanted, "nothing extra came back" IS the whole check.
    configure({
      call: async () => ({
        pagination: { total: 100 },
        active_filters: { criteria: [{ type: "sector_ids", sectors: ["5134"] }] },
      }),
    });
    const row = await lb.coverageTotal({ ask: "x" });
    expect(row.trusted).toBe(false); // a stale filter is still narrowing it
  });
});

describe("lb.coverageBuckets derives values from the book", () => {
  it("tallies a field and orders by how much of the book sits in each", async () => {
    configure({
      call: async () => ({
        leads: [
          { sector_id: "5134" },
          { sector_id: "5136" },
          { sector_id: "5134" },
          { sector_id: "5134" },
        ],
      }),
    });
    const buckets = await lb.coverageBuckets({
      field: "sector_id",
      labels: { "5134": "Supermarchés", "5136": "Supérettes" },
      criterion: (id) => ({ type: "sector_ids", sectors: [id], is_excluded: false }),
      ask: "x",
    });
    expect(buckets.map((b) => [b.label, b.sampled])).toEqual([
      ["Supermarchés", 3],
      ["Supérettes", 1],
    ]);
    expect(buckets[0].criterion).toEqual({
      type: "sector_ids",
      sectors: ["5134"],
      is_excluded: false,
    });
  });

  it("skips the API's literal \"null\" string, which is not a value", async () => {
    configure({
      call: async () => ({ leads: [{ sector_id: "null" }, { sector_id: "" }, { sector_id: "5134" }] }),
    });
    const buckets = await lb.coverageBuckets({ field: "sector_id", ask: "x" });
    expect(buckets.map((b) => b.id)).toEqual(["5134"]);
  });

  it("caps the list, because a sequential sweep of an unbounded one never ends", async () => {
    configure({
      call: async () => ({
        leads: Array.from({ length: 30 }, (_, i) => ({ sector_id: String(i) })),
      }),
    });
    const buckets = await lb.coverageBuckets({ field: "sector_id", ask: "x", limit: 5 });
    expect(buckets).toHaveLength(5);
  });

  it("falls back to a readable label rather than printing a bare id", async () => {
    configure({ call: async () => ({ leads: [{ sector_id: "9999" }] }) });
    const [b] = await lb.coverageBuckets({ field: "sector_id", ask: "x" });
    expect(b.label).toBe("sector_id 9999");
  });

  it("samples UNFILTERED, so the bucket list is not shaped by the stored filter", async () => {
    calls = [];
    configure({
      call: async (tool, args) => {
        calls.push({ tool, args: args as Record<string, unknown> });
        return { leads: [] };
      },
    });
    await lb.coverageBuckets({ field: "sector_id", ask: "x" });
    expect((calls[0].args as any).filtered).toBe(false);
  });
});
