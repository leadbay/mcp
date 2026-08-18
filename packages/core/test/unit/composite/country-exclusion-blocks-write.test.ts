/**
 * A write must never be talked into the OPPOSITE of an exclusion
 * (product#3951).
 *
 * Dropping an INCLUDE of a country widens the result — at worst imprecise, and
 * for the home country it is exactly right. Dropping an EXCLUDE inverts it.
 * `newLens({sectors: ["Healthcare"], exclude_locations: ["France"]})` on FR
 * asks for an audience with nothing in it; re-calling without the exclusion
 * persists a lens of French healthcare companies — every company the user
 * asked to remove, written to the lens and reported as done.
 *
 * The previous round's `otherScope` carve-out reached exactly this case: a
 * surviving sector made the guard say "drop the geo argument and re-call with
 * the rest intact". A surviving criterion does not make the inversion less
 * wrong; it only decides how much of it gets written. So an un-droppable
 * exclusion blocks the write whatever else survives.
 *
 * Only a FOREIGN exclusion is provably a no-op — there is nothing here to
 * remove — so only that one may be dropped and carried on with.
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
import { pullFollowups } from "../../../src/composite/pull-followups.js";
import {
  detectCountryLocations,
  countryLocationEnvelope,
} from "../../../src/composite/_country-guard.js";

const frClient = () => new LeadbayClient("https://api-fr.leadbay.app", "u.test-token", "fr");
const customClient = () =>
  new LeadbayClient("https://staging.internal.example", "u.test-token", "custom");

beforeEach(() => resetHttpMock());

const INVERTS = /persists the opposite|persists the OPPOSITE/;
const CARRY = /re-call ONCE with the rest of the request intact/;

describe("a home-country exclusion stops the write, whatever else survives", () => {
  it("new_lens: a sector does not license dropping the exclusion", async () => {
    mockHttp([]);
    const result: any = await newLens.execute(frClient(), {
      name: "Not France",
      sectors: ["Healthcare"],
      exclude_locations: ["France"],
      confirm: true,
    });
    expect(result.status).toBe("country_level_location");
    expect(
      result.hint,
      "re-calling here writes French healthcare companies — the opposite of the ask"
    ).not.toMatch(CARRY);
    expect(result.hint).toMatch(INVERTS);
    expect(result.hint).toMatch(/Write NOTHING/);
    expect(result.hint, "and it must offer the carve-out that WOULD work").toMatch(
      /carved out/
    );
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("adjust_audience: same, on the tool whose criteria merge irreversibly", async () => {
    mockHttp([]);
    const result: any = await adjustAudience.execute(frClient(), {
      sectors: ["Healthcare"],
      exclude_locations: ["France"],
    });
    expect(result.hint).not.toMatch(CARRY);
    expect(result.hint).toMatch(INVERTS);
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("a surviving city in the same argument does not license it either", async () => {
    // Excluding Paris is honourable; excluding France is not, and writing the
    // Paris half alone still leaves the lens holding French companies.
    mockHttp([]);
    const result: any = await newLens.execute(frClient(), {
      name: "Neither",
      sectors: ["Healthcare"],
      exclude_locations: ["Paris", "France"],
      confirm: true,
    });
    expect(result.hint).toMatch(/Write NOTHING/);
    expect(result.hint).not.toMatch(/other exclusions still apply/i);
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("a group mixing a home and a foreign exclusion still stops on the home one", async () => {
    mockHttp([]);
    const result: any = await newLens.execute(frClient(), {
      name: "Both",
      sectors: ["Healthcare"],
      exclude_locations: ["France", "Canada"],
      confirm: true,
    });
    expect(result.hint).toMatch(/do NOT re-call without "France"/i);
    expect(result.hint).toMatch(/Write NOTHING/);
  });

  it("a supra-national exclusion stops too — it may cover this workspace", () => {
    const text = countryLocationEnvelope(
      detectCountryLocations(["EMEA"], "exclude_locations", "fr", "exclude"),
      "fr",
      "write",
      true
    ).hint;
    expect(text).toMatch(/may well cover this whole workspace/);
    expect(text).toMatch(/Write NOTHING/);
  });

  it("an unknown-country exclusion on a custom backend stops too", async () => {
    mockHttp([]);
    const result: any = await newLens.execute(customClient(), {
      name: "Not France",
      sectors: ["Healthcare"],
      exclude_locations: ["France"],
      confirm: true,
    });
    expect(result.hint).toMatch(/Write NOTHING/);
    expect(result.hint).toMatch(/unknown/i);
  });
});

describe("what the exclusion block must NOT stop", () => {
  it("a FOREIGN exclusion is a provable no-op, so the write goes through", async () => {
    // Nothing in an FR workspace is in Canada, so dropping this exclusion
    // changes nothing at all — the sector criterion is still what the user
    // asked for and must be written.
    mockHttp([]);
    const result: any = await newLens.execute(frClient(), {
      name: "Healthcare",
      sectors: ["Healthcare"],
      exclude_locations: ["Canada"],
      confirm: true,
    });
    expect(result.hint).toMatch(CARRY);
    expect(result.hint).not.toMatch(/Write NOTHING/);
    expect(result.hint).toMatch(/no Canada audience to add/);
  });

  it("an INCLUDE of the home country beside a sector still re-calls", async () => {
    mockHttp([]);
    const result: any = await newLens.execute(frClient(), {
      name: "Healthcare",
      sectors: ["Healthcare"],
      locations: ["France"],
      confirm: true,
    });
    expect(result.hint).toMatch(CARRY);
    expect(result.hint).not.toMatch(INVERTS);
  });

  it("the READ tools are untouched — nothing is being written there", async () => {
    mockHttp([]);
    const result: any = await pullFollowups.execute(frClient(), { city: "France" });
    expect(result.hint).toMatch(/Whole-workspace intent = OMIT city entirely/);
    expect(result.hint).not.toMatch(/Write NOTHING/);
  });
});
