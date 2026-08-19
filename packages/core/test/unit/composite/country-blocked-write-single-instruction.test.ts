/**
 * A blocked exclusion fails the WHOLE write closed, in ONE instruction
 * (product#3951).
 *
 * The stop was correct and its packaging was not. Hints are built per argument,
 * so a request could carry two live instructions at once:
 *
 *   {locations: ["France"], exclude_locations: ["France"], sectors: [...]}
 *     → "drop `locations` and re-call ONCE with the rest of the request intact"
 *     → "write nothing"
 *
 * and an agent that acts on the first has already persisted the inversion. The
 * same contradiction fitted inside a single argument, where the surgical
 * "remove these and re-call" was prepended to the STOP: on
 * `exclude_locations: ["France", "EU", "Paris"]` the first half licenses a
 * Paris-only exclusion that keeps every French company the user asked to
 * remove.
 *
 * So the envelope reconciles the write globally, before any per-argument hint
 * is emitted, and the resulting text contains no re-call directive at all.
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
import {
  detectCountryLocationsIn,
  countryLocationEnvelope,
} from "../../../src/composite/_country-guard.js";

const frClient = () => new LeadbayClient("https://api-fr.leadbay.app", "u.test-token", "fr");

beforeEach(() => resetHttpMock());

/** Every phrasing in this module that authorises a call. None may appear. */
const RECALL = [
  /re-call ONCE/i,
  /in ONE re-call/i,
  /Remove ALL of/i,
  /Remove ONLY/i,
  /Remove every one of/i,
  /and re-call with the rest/i,
];

const writeHint = (
  params: ReadonlyArray<{ input: unknown; param: string; axis?: "include" | "exclude" }>
) =>
  countryLocationEnvelope(detectCountryLocationsIn(params, "fr"), "fr", "write", true).hint;

const expectFailClosed = (hint: string) => {
  for (const pattern of RECALL) {
    expect(hint, `a blocked write must not carry ${pattern} — it authorises the mutation`).not.toMatch(
      pattern
    );
  }
  expect(hint).toMatch(/Write NOTHING/);
  expect(hint).toMatch(/do NOT re-call this tool in any form/i);
};

describe("one instruction, no re-call directive", () => {
  it("several blocked values beside a valid sibling on one argument", () => {
    const hint = writeHint([
      { input: ["France", "EU", "Paris"], param: "exclude_locations", axis: "exclude" },
    ]);
    expectFailClosed(hint);
    expect(hint).toMatch(/not without "France", "EU"/);
    // Both reasons, since they are different reasons.
    expect(hint).toMatch(/"France" is this entire workspace/);
    expect(hint).toMatch(/"EU" is a supra-national scope/);
  });

  it("a blocked exclusion dominates an include hit on ANOTHER argument", () => {
    const hint = writeHint([
      { input: ["France"], param: "locations" },
      { input: ["France"], param: "exclude_locations", axis: "exclude" },
    ]);
    expectFailClosed(hint);
    // Exactly one instruction — no second hint trailing behind it.
    expect(hint.match(/Write NOTHING/g)).toHaveLength(1);
  });

  it("and dominates a legitimate-looking include of a foreign country too", () => {
    const hint = writeHint([
      { input: ["Canada"], param: "locations" },
      { input: ["France"], param: "exclude_locations", axis: "exclude" },
    ]);
    expectFailClosed(hint);
    // The other country still has to come off whenever a corrected call is
    // made — named once, as a note, not as an alternative action.
    expect(hint).toMatch(/"Canada" must come off it too/);
  });

  it("does not name the blocker twice when it arrives on both axes", () => {
    const hint = writeHint([
      { input: ["France"], param: "locations" },
      { input: ["France"], param: "exclude_locations", axis: "exclude" },
    ]);
    expect(hint).not.toMatch(/must come off it too/);
  });

  it("says the rest of the request cannot be written either", () => {
    // The point an agent is most likely to talk itself out of: the sectors are
    // fine, so why not write those? Because they would be written under a scope
    // that inverts the ask.
    const hint = writeHint([
      { input: ["France"], param: "exclude_locations", axis: "exclude" },
    ]);
    expect(hint).toMatch(/rest of the request cannot be written either/i);
  });
});

describe("through the real tool", () => {
  it("new_lens with sectors and a home-country exclusion writes nothing", async () => {
    mockHttp([]);
    const result: any = await newLens.execute(frClient(), {
      name: "Not France",
      sectors: ["Healthcare"],
      locations: ["France"],
      exclude_locations: ["France", "EU", "Paris"],
      confirm: true,
    });
    expect(result.status).toBe("country_level_location");
    expectFailClosed(result.hint);
    expect(getHttpRequests()).toHaveLength(0);
  });
});

describe("what the global reconciliation must NOT swallow", () => {
  it("a FOREIGN exclusion alone still carries the re-call", () => {
    const hint = writeHint([
      { input: ["Canada"], param: "exclude_locations", axis: "exclude" },
    ]);
    expect(hint).toMatch(/re-call ONCE with the rest of the request intact/);
    expect(hint).not.toMatch(/Write NOTHING/);
  });

  it("an INCLUDE-only write keeps its per-argument instructions", () => {
    const hint = writeHint([
      { input: ["France"], param: "locations" },
      { input: ["Canada"], param: "location_ids" },
    ]);
    expect(hint).not.toMatch(/Write NOTHING/);
    expect(hint).toMatch(/locations/);
    expect(hint).toMatch(/location_ids/);
  });

  it("READS are untouched — nothing is being written there", () => {
    const hint = countryLocationEnvelope(
      detectCountryLocationsIn(
        [{ input: ["France"], param: "exclude_locations", axis: "exclude" }],
        "fr"
      ),
      "fr"
    ).hint;
    expect(hint).toMatch(/Excluding France excludes this ENTIRE workspace/);
    expect(hint).not.toMatch(/Write NOTHING/);
  });
});
