/**
 * The write-stop must not eat the rest of the request (product#3951).
 *
 * "Write nothing" is right for a country-ONLY ask: `new_lens({name, locations:
 * ["France"]})` on FR is a lens created to express a scope the workspace
 * already has, and WORKFLOWS.md forbids writing it. It is wrong the moment a
 * real criterion rides along. `new_lens({sectors: ["Healthcare"], locations:
 * ["France"]})` is a Healthcare lens with a redundant country attached, and
 * refusing it discards the only part the user cared about — a strictly worse
 * outcome than the bug the stop was added for.
 *
 * `hit.kept` cannot see this: it holds siblings from the SAME argument, and
 * `sectors` is a different argument entirely. So the call sites compute
 * `otherScope` across the whole request and hand it to the guard.
 *
 * Every case still asserts an empty `getHttpRequests()` — the guard runs before
 * any I/O either way; what changes is what it tells the agent to do next.
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
import { newLens } from "../../../src/composite/new-lens.js";
import { adjustAudience } from "../../../src/composite/adjust-audience.js";
import { updateLensFilter } from "../../../src/tools/update-lens-filter.js";
import { filterCarriesOtherScope } from "../../../src/composite/_country-guard.js";

const frClient = () => new LeadbayClient("https://api-fr.leadbay.app", "u.test-token", "fr");

beforeEach(() => resetHttpMock());

const CARRY = /re-call ONCE with the rest of the request intact/;
const STOP = /Write NOTHING/;

describe("new_lens — a real criterion beside the country is still written", () => {
  it("sectors survive: the recovery re-calls, it does not stop", async () => {
    mockHttp([]);
    const result: any = await newLens.execute(frClient(), {
      name: "Healthcare",
      sectors: ["Healthcare"],
      locations: ["France"],
      confirm: true,
    });
    expect(result.status).toBe("country_level_location");
    expect(result.hint, "refusing this discards the Healthcare criterion").not.toMatch(STOP);
    expect(result.hint).toMatch(CARRY);
    expect(result.hint).toMatch(/already covers all of France/);
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("sizes count as scope too", async () => {
    mockHttp([]);
    const result: any = await newLens.execute(frClient(), {
      name: "Mid-market",
      sizes: [{ min: 30, max: 300 }],
      locations: ["France"],
      confirm: true,
    });
    expect(result.hint).toMatch(CARRY);
    expect(result.hint).not.toMatch(STOP);
  });

  it("excluded sectors count as scope too", async () => {
    mockHttp([]);
    const result: any = await newLens.execute(frClient(), {
      name: "Not retail",
      exclude_sectors: ["Retail"],
      locations: ["France"],
      confirm: true,
    });
    expect(result.hint).toMatch(CARRY);
  });

  it("a name alone is NOT scope — that is the country-only lens", async () => {
    // A display name says nothing about which companies belong in the lens, so
    // this is exactly the write WORKFLOWS.md forbids.
    mockHttp([]);
    const result: any = await newLens.execute(frClient(), {
      name: "All France",
      locations: ["France"],
      confirm: true,
    });
    expect(result.hint).toMatch(STOP);
    expect(result.hint).not.toMatch(CARRY);
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("a FOREIGN country beside a real criterion stops the write entirely", async () => {
    // This asserted the opposite until review caught it. "Canadian healthcare"
    // on an FR workspace does not decompose into a country half that fails and
    // a sector half that succeeds: "Healthcare" was qualifying "Canada". Writing
    // it alone persists a real, saved FRENCH-healthcare lens that nobody asked
    // for — and it reads, in the product, exactly like the request being
    // honoured. A sector is only independently valid scope when the territory
    // it qualifies is one this workspace actually has.
    mockHttp([]);
    const result: any = await newLens.execute(frClient(), {
      name: "Canadian healthcare",
      sectors: ["Healthcare"],
      locations: ["Canada"],
      confirm: true,
    });
    expect(result.hint).toMatch(STOP);
    expect(result.hint).not.toMatch(CARRY);
    expect(result.hint).toMatch(/no such audience to create/);
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("a foreign country mixed with the home one stops on the foreign half", async () => {
    // "France" alone would be droppable here; "Canada" is not, and the presence
    // of a droppable value must not soften the verdict on the other.
    mockHttp([]);
    const result: any = await newLens.execute(frClient(), {
      name: "Both",
      sectors: ["Healthcare"],
      locations: ["France", "Canada"],
      confirm: true,
    });
    expect(result.hint).toMatch(STOP);
    expect(result.hint).not.toMatch(/re-call ONCE with the rest of the request intact/);
    // The droppable one is still named, so the eventual corrected call is right
    // the first time rather than one value per turn.
    expect(result.hint).toMatch(/"France"/);
    expect(getHttpRequests()).toHaveLength(0);
  });
});

describe("adjust_audience — same narrowing", () => {
  it("a sector adjustment beside a country is a legitimate write", async () => {
    mockHttp([]);
    const result: any = await adjustAudience.execute(frClient(), {
      sectors: ["Healthcare"],
      locations: ["France"],
    });
    expect(result.hint).toMatch(CARRY);
    expect(result.hint).not.toMatch(STOP);
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("resolved sector ids count as scope", async () => {
    mockHttp([]);
    const result: any = await adjustAudience.execute(frClient(), {
      sector_ids: ["42"],
      locations: ["France"],
    });
    expect(result.hint).toMatch(CARRY);
  });

  it("a country on its own still stops", async () => {
    mockHttp([]);
    const result: any = await adjustAudience.execute(frClient(), {
      locations: ["France"],
    });
    expect(result.hint).toMatch(STOP);
  });
});

describe("update_lens_filter — scope is read off the criteria", () => {
  const filterWith = (criteria: unknown[]) => ({
    lens_filter: { items: [{ criteria }] },
    locations: { results: [], parents: [] },
  });

  it("filterCarriesOtherScope sees a non-location criterion", () => {
    expect(
      filterCarriesOtherScope(
        filterWith([
          { type: "location_ids", locations: ["France"] },
          { type: "sector_ids", sectors: ["42"] },
        ])
      )
    ).toBe(true);
  });

  it("and reports none when only locations are present", () => {
    expect(
      filterCarriesOtherScope(filterWith([{ type: "location_ids", locations: ["France"] }]))
    ).toBe(false);
    expect(filterCarriesOtherScope(undefined)).toBe(false);
    expect(filterCarriesOtherScope({})).toBe(false);
  });

  it("a sector criterion beside the country is not discarded", async () => {
    mockHttp([]);
    let thrown: any;
    try {
      await updateLensFilter.execute(frClient(), {
        lensId: 4242,
        filter: filterWith([
          { type: "location_ids", locations: ["France"], is_excluded: false },
          { type: "sector_ids", sectors: ["42"] },
        ]) as any,
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown.code).toBe("COUNTRY_LEVEL_LOCATION");
    expect(
      thrown.hint,
      "update_lens_filter REPLACES the filter, so stopping here loses the sector criterion"
    ).not.toMatch(STOP);
    expect(thrown.hint).toMatch(CARRY);
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("a country-only filter still stops", async () => {
    mockHttp([]);
    let thrown: any;
    try {
      await updateLensFilter.execute(frClient(), {
        lensId: 4242,
        filter: filterWith([
          { type: "location_ids", locations: ["France"], is_excluded: false },
        ]) as any,
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown.hint).toMatch(STOP);
    expect(getHttpRequests()).toHaveLength(0);
  });
});

describe("what otherScope must NOT change", () => {
  it("a country beside a real PLACE keeps the surgical recovery", async () => {
    // kept and otherScope are different things: here the argument itself
    // survives, so the instruction is to trim it, not to drop it.
    mockHttp([]);
    const result: any = await newLens.execute(frClient(), {
      name: "Paris healthcare",
      sectors: ["Healthcare"],
      locations: ["Paris", "France"],
      confirm: true,
    });
    expect(result.hint).toMatch(/Remove ONLY "France"/);
    expect(result.hint).not.toMatch(STOP);
    expect(result.hint).not.toMatch(CARRY);
  });
});
