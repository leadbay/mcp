/**
 * leadbay_update_lens_filter refuses country-level locations (product#3951).
 *
 * This is the rawest write path to a `location_ids` criterion — the body is an
 * opaque FilterPayload POSTed straight through — so it is the easiest place to
 * smuggle a country in, and the damage is persistent: the lens stays fenced to
 * a same-named commune for every later pull.
 *
 * Unlike the composites, this tool THROWS for input problems, so the guard
 * matches that idiom rather than inventing a status envelope for one tool.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
  getHttpRequests,
} from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { updateLensFilter } from "../../../src/tools/update-lens-filter.js";

const FR_BASE = "https://api-fr.leadbay.app";
const frClient = () => new LeadbayClient(FR_BASE, "u.test-token", "fr");

const criterionFilter = (locations: unknown) => ({
  lens_filter: {
    items: [{ criteria: [{ type: "location_ids", is_excluded: false, locations }] }],
  },
  locations: { results: [], parents: [] },
});

beforeEach(() => resetHttpMock());

describe("leadbay_update_lens_filter — country guard", () => {
  it("throws a named error for a country in a location_ids criterion", async () => {
    mockHttp([]);
    await expect(
      updateLensFilter.execute(frClient(), {
        lensId: 4242,
        filter: criterionFilter(["France"]) as any,
      })
    ).rejects.toMatchObject({
      error: true,
      code: "COUNTRY_LEVEL_LOCATION",
    });
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("still throws on a DRY RUN", async () => {
    // The guard precedes the dry_run short-circuit on purpose: echoing a
    // cheerful `would_call` for a country-bearing payload would teach the agent
    // the payload is valid, and it would send the real one next.
    mockHttp([]);
    await expect(
      updateLensFilter.execute(frClient(), {
        lensId: 4242,
        filter: criterionFilter(["France"]) as any,
        dry_run: true,
      })
    ).rejects.toMatchObject({ code: "COUNTRY_LEVEL_LOCATION" });
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("catches a country that arrived as a resolved id, via the echoed block", async () => {
    // The criterion carries only numeric ids, but a filter round-tripped
    // through get_lens_filter echoes the resolved areas WITH their names —
    // the only client-side way to see a country behind an id.
    mockHttp([]);
    await expect(
      updateLensFilter.execute(frClient(), {
        lensId: 4242,
        filter: {
          lens_filter: {
            items: [{ criteria: [{ type: "location_ids", is_excluded: false, locations: ["27925"] }] }],
          },
          locations: {
            results: [{ id: "27925", name: "France", country: "FR", level: 2, parent_ids: [] }],
            parents: [],
          },
        } as any,
      })
    ).rejects.toMatchObject({ code: "COUNTRY_LEVEL_LOCATION" });
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("names the offending path and states the omit rule", async () => {
    mockHttp([]);
    let thrown: any;
    try {
      await updateLensFilter.execute(frClient(), {
        lensId: 4242,
        filter: criterionFilter(["France"]) as any,
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown.message).toContain("criteria[].locations");
    expect(thrown.message).toContain("France");
    // NOT "omit the criterion and re-call": update_lens_filter replaces the
    // whole filter, so re-calling without the criterion rewrites the lens to
    // express no scope — the mutation WORKFLOWS.md forbids for a country-wide
    // ask. The recovery has to stop.
    expect(thrown.hint).toMatch(/Write NOTHING/);
    expect(thrown.hint).toMatch(/do NOT re-call this tool/i);
  });

  it("writes a clean filter through untouched", async () => {
    mockHttp([
      { method: "POST", path: "/1.6/lenses/4242/filter", status: 200, body: {} },
    ]);
    const result: any = await updateLensFilter.execute(frClient(), {
      lensId: 4242,
      filter: {
        lens_filter: {
          items: [{ criteria: [{ type: "location_ids", is_excluded: false, locations: ["416102"] }] }],
        },
        locations: {
          results: [{ id: "416102", name: "Île-de-France", country: "FR", level: 5, parent_ids: [] }],
          parents: [],
        },
      } as any,
    });
    expect(result).toEqual({ updated: true, lens_id: 4242 });
    expect(getHttpRequests()).toHaveLength(1);
  });

  it("tolerates a malformed filter without inventing a country error", async () => {
    // A tolerant walk must not turn a shape problem into COUNTRY_LEVEL_LOCATION
    // — that would send the agent chasing a location bug it does not have.
    for (const filter of [null, {}, { lens_filter: {} }, { lens_filter: { items: "x" } }]) {
      resetHttpMock();
      mockHttp([
        { method: "POST", path: "/1.6/lenses/4242/filter", status: 200, body: {} },
      ]);
      const result: any = await updateLensFilter.execute(frClient(), {
        lensId: 4242,
        filter: filter as any,
      });
      expect(result).toEqual({ updated: true, lens_id: 4242 });
    }
  });
});
