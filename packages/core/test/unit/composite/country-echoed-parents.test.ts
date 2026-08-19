/**
 * A breadcrumb is not a filter value (product#3951).
 *
 * A round-tripped lens filter carries `locations.results` and
 * `locations.parents` as denormalized lookup data — names for ids the criteria
 * reference, plus the ancestor chain the UI shows as "Limoges ‹ Haute-Vienne ‹
 * Nouvelle-Aquitaine ‹ France". The country almost always appears in that
 * chain, because every French admin area has France as an ancestor.
 *
 * The echoed blocks were added for one narrow job: a country selected as a bare
 * numeric id is invisible in the criteria, and only the echoed row puts a name
 * on it. Scanning every row instead of the selected ones inverted the guard —
 * a filter legitimately scoped to Île-de-France was rejected because its
 * breadcrumb mentions France, blocking a valid update_lens_filter outright.
 *
 * So a row participates only when a location_ids criterion actually selects its
 * id. A country passed by NAME inside a criterion never depended on this path;
 * criteriaHits catches it directly.
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
import {
  detectCountryLocationsInFilter,
  filterCarriesOtherScope,
} from "../../../src/composite/_country-guard.js";

const frClient = () => new LeadbayClient("https://api-fr.leadbay.app", "u.test-token", "fr");

beforeEach(() => resetHttpMock());

/** What the backend really echoes for a filter scoped to one région. */
const IDF_FILTER = {
  lens_filter: {
    items: [{ criteria: [{ type: "location_ids", is_excluded: false, locations: ["416102"] }] }],
  },
  locations: {
    results: [{ id: "416102", name: "Île-de-France", level: 5, parent_ids: ["1"] }],
    parents: [{ id: "1", name: "France", level: 2 }],
  },
};

describe("parent breadcrumbs do not make a filter country-level", () => {
  it("a région-scoped filter whose ancestor is France passes", () => {
    expect(detectCountryLocationsInFilter(IDF_FILTER, "fr")).toEqual([]);
  });

  it("and update_lens_filter writes it instead of throwing", async () => {
    mockHttp([{ method: "POST", path: "/1.6/lenses/4242/filter", status: 200, body: {} }]);
    await expect(
      updateLensFilter.execute(frClient(), { lensId: 4242, filter: IDF_FILTER as any })
    ).resolves.toBeDefined();
    expect(getHttpRequests().length).toBeGreaterThan(0);
  });

  it("a deep breadcrumb — city ‹ département ‹ région ‹ country — passes too", () => {
    const filter = {
      lens_filter: {
        items: [{ criteria: [{ type: "location_ids", locations: ["27925"] }] }],
      },
      locations: {
        results: [{ id: "27925", name: "Limoges", level: 7 }],
        parents: [
          { id: "87", name: "Haute-Vienne", level: 6 },
          { id: "75", name: "Nouvelle-Aquitaine", level: 5 },
          { id: "1", name: "France", level: 2 },
        ],
      },
    };
    expect(detectCountryLocationsInFilter(filter, "fr")).toEqual([]);
  });

  it("an unreferenced row in results is lookup data too, not a selection", () => {
    // Same rule, same reason: results is denormalized, and a row nothing
    // selects is not a filter value.
    const filter = {
      lens_filter: {
        items: [{ criteria: [{ type: "location_ids", locations: ["416102"] }] }],
      },
      locations: {
        results: [
          { id: "416102", name: "Île-de-France" },
          { id: "1", name: "France" },
        ],
        parents: [],
      },
    };
    expect(detectCountryLocationsInFilter(filter, "fr")).toEqual([]);
  });
});

describe("what the narrowing must NOT let through", () => {
  it("a country SELECTED by bare id is still caught by its echoed name", () => {
    // The reason the echoed blocks are consulted at all: "1" says nothing, and
    // the criterion carries no name. Correlating it to the row is what makes
    // the id-only ingress visible.
    const filter = {
      lens_filter: { items: [{ criteria: [{ type: "location_ids", locations: ["1"] }] }] },
      locations: { results: [{ id: "1", name: "France", level: 2 }], parents: [] },
    };
    const hits = detectCountryLocationsInFilter(filter, "fr");
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe("home_country");
  });

  it("a selected country appearing only in the PARENTS block is still caught", () => {
    // Which block the name lives in is a backend detail; selection is what
    // matters. A criterion naming this id means the country IS filtered on.
    const filter = {
      lens_filter: { items: [{ criteria: [{ type: "location_ids", locations: ["1"] }] }] },
      locations: { results: [], parents: [{ id: "1", name: "France", level: 2 }] },
    };
    expect(detectCountryLocationsInFilter(filter, "fr")).toHaveLength(1);
  });

  it("a selected country keeps the criterion's exclude polarity", () => {
    const filter = {
      lens_filter: {
        items: [{ criteria: [{ type: "location_ids", is_excluded: true, locations: ["1"] }] }],
      },
      locations: { results: [{ id: "1", name: "France" }], parents: [] },
    };
    expect(detectCountryLocationsInFilter(filter, "fr")[0].axis).toBe("exclude");
  });

  it("a country passed by NAME never depended on the echoed blocks", () => {
    const filter = {
      lens_filter: { items: [{ criteria: [{ type: "location_ids", locations: ["France"] }] }] },
      locations: { results: [], parents: [] },
    };
    const hits = detectCountryLocationsInFilter(filter, "fr");
    expect(hits).toHaveLength(1);
    expect(hits[0].param).toContain("criteria[].locations");
  });

  it("numeric and string ids correlate across the two shapes", async () => {
    // The criterion may carry 1 and the row "1"; both are the same selection.
    const filter = {
      lens_filter: { items: [{ criteria: [{ type: "location_ids", locations: [1] }] }] },
      locations: { results: [{ id: "1", name: "France" }], parents: [] },
    };
    expect(detectCountryLocationsInFilter(filter, "fr")).toHaveLength(1);
  });
});

describe("an id the echoed block names as a country is not surviving scope", () => {
  const filterWith = (criteria: unknown[], results: unknown[], parents: unknown[] = []) => ({
    lens_filter: { items: [{ criteria }] },
    locations: { results, parents },
  });

  it("a country selected by bare id leaves nothing to write", () => {
    // Everywhere else in this module an opaque id counts as real scope —
    // nothing can tell "416102" from a country (product#3939). That limit does
    // not apply when the SAME payload names it: the id is known to be a
    // country, and calling it surviving scope produced "remove the country and
    // re-call with the remainder", where the remainder is nothing. The
    // corrected call would replace the lens with an empty filter.
    expect(
      filterCarriesOtherScope(
        filterWith([{ type: "location_ids", locations: ["1"] }], [{ id: "1", name: "France" }]),
        "fr"
      )
    ).toBe(false);
  });

  it("a real place beside it still counts", () => {
    expect(
      filterCarriesOtherScope(
        filterWith(
          [{ type: "location_ids", locations: ["1", "416102"] }],
          [
            { id: "1", name: "France" },
            { id: "416102", name: "Île-de-France" },
          ]
        ),
        "fr"
      )
    ).toBe(true);
  });

  it("an id nothing names still counts — that limit is unchanged", () => {
    expect(
      filterCarriesOtherScope(filterWith([{ type: "location_ids", locations: ["999"] }], []), "fr")
    ).toBe(true);
  });

  it("a country named only in the parents block is discounted too", () => {
    expect(
      filterCarriesOtherScope(
        filterWith([{ type: "location_ids", locations: ["1"] }], [], [{ id: "1", name: "France" }]),
        "fr"
      )
    ).toBe(false);
  });

  it("update_lens_filter tells the agent to write nothing, not to empty the filter", async () => {
    mockHttp([]);
    let thrown: any;
    try {
      await updateLensFilter.execute(frClient(), {
        lensId: 4242,
        filter: filterWith(
          [{ type: "location_ids", locations: ["1"], is_excluded: false }],
          [{ id: "1", name: "France" }]
        ) as any,
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown.code).toBe("COUNTRY_LEVEL_LOCATION");
    expect(thrown.hint).toMatch(/Write NOTHING/);
    expect(
      thrown.hint,
      "re-calling with the remainder replaces the lens with an empty filter"
    ).not.toMatch(/re-call ONCE with the rest of the request intact/);
    expect(getHttpRequests()).toHaveLength(0);
  });
});
