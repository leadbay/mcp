/**
 * A country-wide scope must not be answered by WRITING (product#3951).
 *
 * The shared recovery was written for the read tools, where it is exactly
 * right: `pull_followups` re-called without `city` returns every follow-up,
 * which is what a whole-country ask meant. On a lens-writing tool the same
 * instruction inverts. `new_lens` re-called without `locations` CREATES a lens
 * with no geography; `adjust_audience` REWRITES the active lens's criteria;
 * `update_lens_filter` replaces the whole filter. All three persist a change
 * that expresses no scope at all, in order to say something the workspace
 * already is — and WORKFLOWS.md's "Country-wide scope — omit the location
 * filter" row names those exact three tools in `forbidden_calls` and requires
 * that NOTHING be written.
 *
 * So the split is not read-vs-write in general: it is "would the re-call leave
 * the argument EMPTY". A country beside a real place is a perfectly good lens,
 * and those cases must keep the surgical remove-and-re-call recovery.
 *
 * Every case also asserts `getHttpRequests()` is empty, which is what makes
 * "wrote nothing" a fact rather than a claim about the wording.
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
import { pullFollowups } from "../../../src/composite/pull-followups.js";

const frClient = () => new LeadbayClient("https://api-fr.leadbay.app", "u.test-token", "fr");

beforeEach(() => resetHttpMock());

/** A round-tripped lens filter carrying one country as a location criterion. */
const criterionFilter = (locations: string[]) => ({
  lens_filter: {
    items: [{ criteria: [{ type: "location_ids", locations, is_excluded: false }] }],
  },
  locations: { results: [], parents: [] },
});

describe("lens-writing tools stop instead of re-calling", () => {
  it("new_lens: a country-only request is answered by writing nothing", async () => {
    mockHttp([]);
    const result: any = await newLens.execute(frClient(), {
      name: "All France",
      locations: ["France"],
      confirm: true,
    });
    expect(result.status).toBe("country_level_location");
    expect(
      result.hint,
      "the read recovery would have the agent create the lens WORKFLOWS.md forbids"
    ).not.toMatch(/Whole-workspace intent = OMIT/);
    expect(result.hint).toMatch(/do NOT re-call this tool with locations omitted/i);
    expect(result.hint).toMatch(/Write NOTHING/);
    // And it must still DELIVER — the workflow requires an answer, not a stall.
    expect(result.hint).toMatch(/already covers all of France/);
    expect(result.hint).toMatch(/sector, size/);
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("adjust_audience: same, on the tool whose criteria merge irreversibly", async () => {
    mockHttp([]);
    const result: any = await adjustAudience.execute(frClient(), {
      locations: ["France"],
    });
    expect(result.hint).toMatch(/Write NOTHING/);
    expect(result.hint).not.toMatch(/Whole-workspace intent = OMIT/);
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("update_lens_filter: the thrown envelope stops too", async () => {
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
    expect(thrown.code).toBe("COUNTRY_LEVEL_LOCATION");
    expect(thrown.hint).toMatch(/Write NOTHING/);
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("a foreign country on a write tool also stops, and says why", async () => {
    mockHttp([]);
    const result: any = await newLens.execute(frClient(), {
      name: "Canada",
      locations: ["Canada"],
      confirm: true,
    });
    expect(result.hint).toMatch(/Write NOTHING/);
    // Reworded when the foreign INCLUDE was promoted to a request-level block:
    // it now dominates the whole call rather than being one argument's verdict,
    // so the reason is stated once for the request.
    expect(result.hint).toMatch(/outside this workspace, so there is no such audience to create/);
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("several country values on a write tool still stop exactly once", async () => {
    mockHttp([]);
    const result: any = await newLens.execute(frClient(), {
      name: "Both",
      locations: ["France", "Canada"],
      confirm: true,
    });
    expect((result.hint.match(/Write NOTHING/g) ?? []).length).toBe(1);
    // One instruction for the request, and the droppable value still named so
    // the eventual corrected call is right the first time.
    expect(result.hint).toMatch(/"France" must come off it too/);
    expect(result.hint).not.toMatch(/re-call ONCE/);
    expect(getHttpRequests()).toHaveLength(0);
  });
});

describe("what the write-stop must NOT swallow", () => {
  it("a country beside a real place keeps the remove-and-re-call recovery", async () => {
    // "Paris" is a lens worth writing. Stopping here would refuse a legitimate
    // request — the stop is for an argument that would be left EMPTY.
    mockHttp([]);
    const result: any = await newLens.execute(frClient(), {
      name: "Paris",
      locations: ["Paris", "France"],
      confirm: true,
    });
    expect(result.hint).toMatch(/Remove ONLY "France"/);
    expect(result.hint).not.toMatch(/Write NOTHING/);
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("the READ tools keep the omit-and-re-call recovery unchanged", async () => {
    // pull_followups with no `city` is every follow-up, which IS the answer to
    // a whole-country ask. Nothing about this may change.
    mockHttp([]);
    const result: any = await pullFollowups.execute(frClient(), { city: "France" });
    expect(result.hint).toMatch(/Whole-workspace intent = OMIT city entirely/);
    expect(result.hint).not.toMatch(/Write NOTHING/);
    expect(getHttpRequests()).toHaveLength(0);
  });
});
