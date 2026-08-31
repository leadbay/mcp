/**
 * Recoveries that were wrong because the TOOL was wrong for them (product#3951).
 *
 * The shared hint says "omit the geo argument and the result covers the whole
 * workspace". That sentence is only true of a tool that reads leads and whose
 * unfiltered read really is the whole workspace. Four tools are not that:
 *
 *  - `adjust_audience` MERGES into an existing lens filter, so the geography
 *    already on the lens survives the re-call. "The lens then carries no geo
 *    criterion" is a claim about a filter nobody has read.
 *  - `scan_portfolio_signals` scans UNFILTERED when its filter POST fails, so a
 *    filter that loses or breaks the caller's other criteria degrades silently.
 *  - `list_locations` is a taxonomy lookup with a REQUIRED `q`; omitting it
 *    fails validation, and its empty-`q` branch returns no results rather than
 *    workspace-wide data.
 *  - and on the echoed-ID path a criterion can still select a real place, so
 *    "remove the whole criterion" would discard it.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory, getHttpRequests } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import {
  countryLocationEnvelope,
  detectCountryLocationsInFilter,
} from "../../../src/composite/_country-guard.js";
import { adjustAudience } from "../../../src/composite/adjust-audience.js";
import { scanPortfolioSignals } from "../../../src/composite/scan-portfolio-signals.js";
import { listLocations } from "../../../src/tools/list-locations.js";

const frClient = () => new LeadbayClient("https://api-fr.leadbay.app", "u.test-token", "fr");

beforeEach(() => resetHttpMock());

describe("adjust_audience warns that the lens keeps its own geography", () => {
  it("names the merge, and where the geography can actually be read", async () => {
    mockHttp([]);
    const result: any = await adjustAudience.execute(frClient(), {
      lensId: 7,
      sectors: ["Healthcare"],
      locations: ["France"],
    });
    expect(result.status).toBe("country_level_location");
    expect(result.hint).toMatch(/re-call ONCE/);
    expect(result.hint).toMatch(/lens:\/\/7\/definition/);
    expect(result.hint).toMatch(/location criteria MERGE here rather than replace/);
    // The two sources that cannot answer it are named, because both look like
    // they should.
    expect(result.hint).toMatch(/returns only `lens: \{id\}`/);
    expect(result.hint).toMatch(/no filter/);
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("falls back to a readable reference when no lensId was passed", async () => {
    mockHttp([]);
    const result: any = await adjustAudience.execute(frClient(), {
      sectors: ["Healthcare"],
      locations: ["France"],
    });
    expect(result.hint).toMatch(/lens:\/\/<the lens being edited>\/definition/);
  });

  it("a write-stop gets no re-call warning", async () => {
    // Nothing else was passed, so the recovery forbids a re-call outright and
    // must not carry text implying one is on the table.
    mockHttp([]);
    const result: any = await adjustAudience.execute(frClient(), {
      lensId: 7,
      locations: ["France"],
    });
    expect(result.hint).toMatch(/Write NOTHING here/);
    expect(result.hint).not.toMatch(/Before that re-call/);
  });
});

describe("scan_portfolio_signals preserves the caller's other criteria", () => {
  it("says to re-send the surviving criteria, and why an invalid filter is not a no-op", async () => {
    mockHttp([]);
    const result: any = await scanPortfolioSignals.execute(frClient(), {
      set_filter: {
        criteria: [
          { type: "location_ids", locations: ["France"] },
          { type: "last_action_date", last_days: 30 },
        ],
      },
    });
    expect(result.status).toBe("country_level_location");
    expect(result.hint).toMatch(/SURVIVING criteria/);
    expect(result.hint).toMatch(/scan UNFILTERED/);
    // The two destructive shortcuts are named as things NOT to do…
    expect(result.hint).toMatch(/do NOT send an empty `criteria` array/);
    // …and pull_followups' stale-filter advice must NOT leak in: this tool has
    // no persisted-filter problem, and `filtered:false` is not its lever.
    expect(result.hint).not.toMatch(/filtered:false/);
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("adds no caveat when nothing else was requested", async () => {
    // Dropping the geo argument really does scan unfiltered here: this tool
    // sends `filtered` only when it stored the filter itself. Unlike
    // pull_followups, there is no stale-filter half to warn about.
    mockHttp([]);
    const result: any = await scanPortfolioSignals.execute(frClient(), { city: "France" });
    expect(result.status).toBe("country_level_location");
    expect(result.hint).toMatch(/OMIT city/);
    expect(result.hint).not.toMatch(/SURVIVING criteria/);
    expect(result.hint).not.toMatch(/filtered:false/);
  });
});

describe("list_locations refuses without offering a retry", () => {
  it("does not tell the caller to omit a required argument", async () => {
    mockHttp([]);
    const result: any = await listLocations.execute(frClient(), { q: "France" });
    expect(result.status).toBe("country_level_location");
    expect(result.results).toEqual([]);
    expect(result.hint).toMatch(/There is no country to look up/);
    expect(result.hint).toMatch(/Do NOT re-call this tool with `q` omitted/);
    // The shared omit-and-claim-coverage recovery must not survive here.
    expect(result.hint).not.toMatch(/OMIT q entirely/);
    expect(result.hint).not.toMatch(/covers everything/);
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("still points somewhere useful", async () => {
    mockHttp([]);
    const result: any = await listLocations.execute(frClient(), { q: "France" });
    expect(result.hint).toMatch(/look up that place instead/);
    expect(result.hint).toMatch(/no location id is needed at all/);
  });

  it("a real place is untouched", async () => {
    mockHttp([
      { method: "GET", path: "/1.6/geo/search?q=Limoges", status: 200, body: { results: [{ id: "1" }], parents: [] } },
    ]);
    const result: any = await listLocations.execute(frClient(), { q: "Limoges" });
    expect(result.status).toBeUndefined();
    expect(result.results).toHaveLength(1);
  });
});

describe("an echoed country beside a real place keeps the place", () => {
  const filter = (locs: string[]) => ({
    lens_filter: { items: [{ criteria: [{ type: "location_ids", locations: locs }] }] },
    locations: {
      results: [
        { id: "27925", name: "France" },
        { id: "99", name: "Paris" },
        { id: "55", name: "Germany" },
      ],
      parents: [],
    },
  });

  it("carries the surviving id, labelled with its echoed name", () => {
    const hits = detectCountryLocationsInFilter(filter(["27925", "99"]), "fr");
    expect(hits).toHaveLength(1);
    expect(hits[0].kept).toEqual(["99 (Paris)"]);
  });

  it("the recovery is surgical, not an omission", () => {
    const hits = detectCountryLocationsInFilter(filter(["27925", "99"]), "fr");
    const { hint } = countryLocationEnvelope(hits, "fr");
    expect(hint).toMatch(/Remove ONLY "France"/);
    expect(hint).not.toMatch(/OMIT/);
    // …and the id note still says which id to actually delete.
    expect(hint).toMatch(/remove "27925"/);
  });

  it("a SECOND country is never listed as something to keep", () => {
    // Otherwise one hit tells the caller to preserve exactly what the other
    // hit is telling them to remove.
    const hits = detectCountryLocationsInFilter(filter(["27925", "55"]), "fr");
    expect(hits).toHaveLength(2);
    for (const hit of hits) expect(hit.kept).toEqual([]);
  });

  it("keeps the criterion when a place survives, removes it when none does", () => {
    const withSibling = (locs: string[]) => ({
      lens_filter: {
        items: [
          {
            criteria: [
              { type: "location_ids", locations: locs },
              { type: "size", sizes: [{ min: 1, max: 9 }] },
            ],
          },
        ],
      },
      locations: filter([]).locations,
    });

    const survives = countryLocationEnvelope(
      detectCountryLocationsInFilter(withSibling(["27925", "99"]), "fr"),
      "fr"
    ).hint;
    expect(survives).toMatch(/Keep the `location_ids` criterion itself/);
    expect(survives).not.toMatch(/remove the WHOLE criterion/);

    const empties = countryLocationEnvelope(
      detectCountryLocationsInFilter(withSibling(["27925"]), "fr"),
      "fr"
    ).hint;
    expect(empties).toMatch(/remove the WHOLE criterion/);
    expect(empties).not.toMatch(/Keep the `location_ids` criterion itself/);
  });
});
