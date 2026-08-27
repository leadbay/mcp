/**
 * Whether a Monitor `set_filter` still carries scope is decided by its VALUES,
 * not by criterion type (product#3951).
 *
 * The first version of this predicate lived inline in `pull_followups` and
 * rejected every criterion of type `location_ids`, on the assumption that a
 * location criterion holding a country holds nothing else. It can — and the
 * offending country does not even have to be in the filter:
 *
 *   pull_followups({ city: "France",
 *                    set_filter: { criteria: [{type:"location_ids",
 *                                              locations:["99"]}] } })
 *
 * puts the offender on `city`, so no hit knows about the Paris id, and the
 * type-only test then reported "nothing else was requested" and advised
 * `filtered:false` — throwing away exactly the scope the caller had asked for.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory, getHttpRequests } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { setFilterCarriesOtherScope } from "../../../src/composite/_country-guard.js";
import { pullFollowups } from "../../../src/composite/pull-followups.js";
import { scanPortfolioSignals } from "../../../src/composite/scan-portfolio-signals.js";

const frClient = () => new LeadbayClient("https://api-fr.leadbay.app", "u.test-token", "fr");
const criteria = (c: unknown[]) => ({ criteria: c });

beforeEach(() => resetHttpMock());

describe("setFilterCarriesOtherScope", () => {
  it("a location criterion holding a real place counts", () => {
    expect(
      setFilterCarriesOtherScope(criteria([{ type: "location_ids", locations: ["99"] }]), "fr")
    ).toBe(true);
    expect(
      setFilterCarriesOtherScope(criteria([{ type: "location_ids", locations: ["Paris"] }]), "fr")
    ).toBe(true);
  });

  it("a location criterion holding ONLY a country does not", () => {
    expect(
      setFilterCarriesOtherScope(criteria([{ type: "location_ids", locations: ["France"] }]), "fr")
    ).toBe(false);
  });

  it("a mixed location criterion counts — the real place would be lost", () => {
    expect(
      setFilterCarriesOtherScope(
        criteria([{ type: "location_ids", locations: ["France", "Paris"] }]),
        "fr"
      )
    ).toBe(true);
  });

  it("any non-geo criterion counts", () => {
    expect(
      setFilterCarriesOtherScope(criteria([{ type: "last_action_date", last_days: 30 }]), "fr")
    ).toBe(true);
    expect(setFilterCarriesOtherScope(criteria([{ type: "liked" }]), "fr")).toBe(true);
  });

  it("nothing, junk and an empty array do not", () => {
    expect(setFilterCarriesOtherScope(undefined, "fr")).toBe(false);
    expect(setFilterCarriesOtherScope("nope", "fr")).toBe(false);
    expect(setFilterCarriesOtherScope(criteria([]), "fr")).toBe(false);
    expect(setFilterCarriesOtherScope({ criteria: "nope" }, "fr")).toBe(false);
  });
});

describe("the offender on `city`, the scope in `set_filter`", () => {
  const params = {
    city: "France",
    set_filter: { criteria: [{ type: "location_ids", locations: ["99"] }] },
  };

  it("pull_followups does not tell the caller to wipe the filter", async () => {
    mockHttp([]);
    const result: any = await pullFollowups.execute(frClient(), params);
    expect(result.status).toBe("country_level_location");
    // The regression was ADVISING `filtered:false`, which discards the Paris
    // criterion. The corrected caveat names it in order to forbid it, so the
    // assertion has to be about the instruction, not the substring.
    expect(result.hint).toMatch(/Do NOT pass `filtered:false`/);
    expect(result.hint).not.toMatch(/Nothing else was requested, so pass `filtered:false`/);
    expect(result.hint).toMatch(/SURVIVING criteria/);
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("scan_portfolio_signals gets the same treatment", async () => {
    mockHttp([]);
    const result: any = await scanPortfolioSignals.execute(frClient(), params);
    expect(result.status).toBe("country_level_location");
    expect(result.hint).toMatch(/SURVIVING criteria/);
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("and with genuinely nothing else, the stale-filter advice still fires", async () => {
    mockHttp([]);
    const result: any = await pullFollowups.execute(frClient(), { city: "France" });
    expect(result.hint).toMatch(/filtered:false/);
    expect(result.hint).toMatch(/Nothing else was requested/);
  });
});
