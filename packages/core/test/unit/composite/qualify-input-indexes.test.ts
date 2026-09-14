/**
 * `ref.input_indexes` must describe THIS caller's `lead_refs`, or say nothing.
 *
 * The qualify idempotency key is order-insensitive on purpose — the same refs
 * in another order are the same approved work — so a reordered retry dedupes
 * onto the ORIGINAL job. That job's `input_indexes` describe the ORIGINAL
 * order, and relaying them maps each skipped-item verdict onto the wrong
 * company: retry `[B, A]` after `[A, B]` and A is reported at index 0.
 *
 * Remap where every item resolves by ref identity; null the indexes for ALL
 * items where any one cannot be matched. A missing index is a gap; a wrong
 * index is a false statement about which company was skipped.
 */

import { describe, it, expect } from "vitest";
import { remapInputIndexes } from "../../../src/composite/_mcp-job-helpers.js";

const item = (requested_as: unknown, input_indexes: number[] | null) =>
  ({
    status: "skipped",
    seq: 1,
    ref: { input_indexes, requested_as },
  }) as any;

describe("remapInputIndexes", () => {
  it("re-points indexes at the current order after a reordered retry", () => {
    // Original job ran [A, B]; this caller sent [B, A].
    const items = [
      item({ website: "a.com" }, [0]),
      item({ website: "b.com" }, [1]),
    ];
    const { items: out, remapped } = remapInputIndexes(items, [
      { website: "b.com" },
      { website: "a.com" },
    ]);
    expect(remapped).toBe(true);
    expect(out[0].ref.input_indexes).toEqual([1]); // a.com is now index 1
    expect(out[1].ref.input_indexes).toEqual([0]); // b.com is now index 0
  });

  it("folds website spelling the same way the key does", () => {
    // The caller pasted a URL; the backend echoed the bare domain.
    const items = [item({ website: "acme.com" }, [0])];
    const { items: out, remapped } = remapInputIndexes(items, [
      { name: "Other" },
      { website: "https://Acme.com/" },
    ]);
    expect(remapped).toBe(true);
    expect(out[0].ref.input_indexes).toEqual([1]);
  });

  it("matches on lead_id when requested_as is absent", () => {
    const id = "7b3c1de2-5f40-4a9c-9d21-0c8ea4f61b55";
    const items = [{ status: "skipped", seq: 1, ref: { input_indexes: [0], lead_id: id } } as any];
    const { items: out, remapped } = remapInputIndexes(items, [
      { name: "Other" },
      { lead_id: id.toUpperCase() },
    ]);
    expect(remapped).toBe(true);
    expect(out[0].ref.input_indexes).toEqual([1]);
  });

  it("nulls EVERY index when any item cannot be matched", () => {
    // Partial remapping would leave a mix of correct and stale indexes with
    // no way for the caller to tell them apart.
    const items = [
      item({ website: "a.com" }, [0]),
      item({ website: "unknown.com" }, [1]),
    ];
    const { items: out, remapped } = remapInputIndexes(items, [
      { website: "a.com" },
    ]);
    expect(remapped).toBe(false);
    expect(out[0].ref.input_indexes).toBeNull();
    expect(out[1].ref.input_indexes).toBeNull();
  });

  it("leaves items that carry no indexes alone", () => {
    const items = [item({ website: "a.com" }, null)];
    const { items: out } = remapInputIndexes(items, [{ website: "a.com" }]);
    expect(out[0].ref.input_indexes).toBeNull();
  });

  it("no refs to map against is a no-op, not a wipe", () => {
    const items = [item({ website: "a.com" }, [0])];
    const { items: out, remapped } = remapInputIndexes(items, undefined);
    expect(remapped).toBe(false);
    expect(out[0].ref.input_indexes).toEqual([0]);
  });
});
