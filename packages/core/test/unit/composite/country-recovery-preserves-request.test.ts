/**
 * The recovery must not destroy what the caller actually asked for (product#3951).
 *
 * Three findings from the round after the sibling / stale-filter / write-stop
 * fixes landed — each one a place where two of those fixes met and the advice
 * they produced together was worse than either alone:
 *
 * 1. Siblings were attached by `criteriaHits` only. A country arriving as a
 *    bare ID is discovered through its echoed name on a separate path, and that
 *    path built a hit with no siblings — so the recovery said "remove the id"
 *    without "and remove the now-empty criterion", authorizing a retry that
 *    carries an invalid `location_ids` criterion holding nothing.
 * 2. `pull_followups` appended "pass `filtered:false`" unconditionally. With a
 *    surviving `last_action_date` criterion that bypasses the very criterion the
 *    sibling note had just promised would survive — and the offered alternative,
 *    `set_filter:{criteria:[]}`, deletes it outright.
 * 3. `new_lens` counted a bare `base` id as surviving scope. Every new lens is a
 *    CLONE, so the authorized retry inherits the base's geography: a Paris-
 *    scoped base becomes a lens named "Nationwide" holding Paris.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory, getHttpRequests } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import {
  countryLocationEnvelope,
  detectCountryLocationsInFilter,
} from "../../../src/composite/_country-guard.js";
import { newLens } from "../../../src/composite/new-lens.js";
import { pullFollowups } from "../../../src/composite/pull-followups.js";

const frClient = () => new LeadbayClient("https://api-fr.leadbay.app", "u.test-token", "fr");

beforeEach(() => resetHttpMock());

describe("a country found by echoed ID carries its criterion's siblings", () => {
  const filterWithSibling = {
    lens_filter: {
      items: [
        {
          criteria: [
            { type: "location_ids", locations: ["27925"] },
            { type: "size", sizes: [{ min: 10, max: 50 }] },
          ],
        },
      ],
    },
    locations: { results: [{ id: "27925", name: "France" }], parents: [] },
  };

  it("records the siblings on the echoed hit", () => {
    const hits = detectCountryLocationsInFilter(filterWithSibling, "fr");
    expect(hits).toHaveLength(1);
    expect(hits[0].selectedId).toBe("27925");
    expect(hits[0].siblingCriteria).toEqual(["size"]);
  });

  it("says to remove the whole criterion, not just the id inside it", () => {
    const hits = detectCountryLocationsInFilter(filterWithSibling, "fr");
    const { hint } = countryLocationEnvelope(hits, "fr");
    // Both halves must be present: which id selects it, AND that the criterion
    // itself goes. Either alone leaves a broken or a still-filtered retry.
    expect(hint).toMatch(/remove "27925"/);
    // The criterion selects nothing else here, so removing the country empties
    // it — and an empty `location_ids` criterion is invalid, not neutral.
    expect(hint).toMatch(/remove the WHOLE criterion/);
    expect(hint).toMatch(/`size`/);
  });

  it("a lone echoed country still gets the id note and no sibling note", () => {
    const hits = detectCountryLocationsInFilter(
      {
        lens_filter: { items: [{ criteria: [{ type: "location_ids", locations: ["27925"] }] }] },
        locations: { results: [{ id: "27925", name: "France" }], parents: [] },
      },
      "fr"
    );
    expect(hits[0].siblingCriteria).toBeUndefined();
    const { hint } = countryLocationEnvelope(hits, "fr");
    expect(hint).toMatch(/remove "27925"/);
    expect(hint).not.toMatch(/Remove the WHOLE/);
  });
});

describe("pull_followups keeps the criteria the caller asked for", () => {
  it("does NOT offer filtered:false when other criteria survive", async () => {
    mockHttp([]);
    const result: any = await pullFollowups.execute(frClient(), {
      set_filter: {
        criteria: [
          { type: "location_ids", locations: ["France"] },
          { type: "last_action_date", last_days: 30 },
        ],
      },
    });
    expect(result.status).toBe("country_level_location");
    // Both destructive options must be named as things NOT to do.
    expect(result.hint).toMatch(/Do NOT pass `filtered:false`/);
    expect(result.hint).toMatch(/do NOT send `set_filter:\{criteria:\[\]\}`/);
    // And the safe route stated: re-send the corrected filter.
    expect(result.hint).toMatch(/SURVIVING criteria/);
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("still offers filtered:false when nothing else was requested", async () => {
    mockHttp([]);
    const result: any = await pullFollowups.execute(frClient(), { city: "France" });
    expect(result.hint).toMatch(/pass `filtered:false`/);
    expect(result.hint).toMatch(/Nothing else was requested/);
  });

  it("says nothing about filtered when the recovery re-sends the filter anyway", async () => {
    mockHttp([]);
    const result: any = await pullFollowups.execute(frClient(), {
      set_filter: {
        criteria: [{ type: "location_ids", locations: ["France", "Paris"] }],
      },
    });
    // "Paris" survives, so the recovery is surgical: remove France, re-call
    // with the rest. That re-POSTs the corrected filter and overwrites the
    // stored one, so no stale filter can leak in and there is nothing to
    // caveat. Advice about `filtered` here would be noise at best — and
    // `filtered:false` would discard Paris.
    expect(result.hint).toMatch(/Remove ONLY "France"/);
    expect(result.hint).not.toMatch(/filtered:false/);
    expect(result.hint).not.toMatch(/set_filter:\{criteria:\[\]\}/);
  });
});

describe("new_lens does not treat an unread base as scope", () => {
  it("a base id alone does not license dropping the country", async () => {
    mockHttp([]);
    const result: any = await newLens.execute(frClient(), {
      name: "Nationwide",
      base: 4242,
      locations: ["France"],
      confirm: true,
    });
    expect(result.status).toBe("country_level_location");
    // The write-stop, not the carry-the-rest recovery: there is no "rest".
    expect(result.hint).toMatch(/Write NOTHING here/);
    expect(result.hint).not.toMatch(/re-call ONCE/);
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("when a retry IS authorized, it warns the clone inherits geography", async () => {
    mockHttp([]);
    const result: any = await newLens.execute(frClient(), {
      name: "Nationwide healthcare",
      sectors: ["Healthcare"],
      locations: ["France"],
      confirm: true,
    });
    expect(result.hint).toMatch(/re-call ONCE/);
    expect(result.hint).toMatch(/lens:\/\//);
    expect(result.hint).toMatch(/A clone INHERITS that geography/);
    // And it names why the obvious sources cannot answer it.
    expect(result.hint).toMatch(/returns only `lens: \{id\}`/);
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("names the explicit base in the resource URI when one was given", async () => {
    mockHttp([]);
    const result: any = await newLens.execute(frClient(), {
      name: "Nationwide healthcare",
      base: 77,
      sectors: ["Healthcare"],
      locations: ["France"],
      confirm: true,
    });
    expect(result.hint).toMatch(/lens:\/\/77\/definition/);
  });

  it("falls back to the active lens when no base was passed", async () => {
    mockHttp([]);
    const result: any = await newLens.execute(frClient(), {
      name: "Nationwide healthcare",
      sectors: ["Healthcare"],
      locations: ["France"],
      confirm: true,
    });
    // Every new lens clones something — the active lens when base is omitted —
    // so the warning must still point somewhere real.
    expect(result.hint).toMatch(/lens:\/\/<active lens id>\/definition/);
  });

  it("a write-stop is NOT given a re-call warning that implies a re-call", async () => {
    mockHttp([]);
    const result: any = await newLens.execute(frClient(), {
      name: "Nationwide",
      locations: ["France"],
      confirm: true,
    });
    expect(result.hint).toMatch(/Write NOTHING here/);
    expect(result.hint).not.toMatch(/Before that re-call/);
  });
});
