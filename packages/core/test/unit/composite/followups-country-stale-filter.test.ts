/**
 * Omitting `city` does not widen `pull_followups` on its own (product#3951).
 *
 * The shared recovery for a home-country value is "OMIT the geo argument, then
 * say the result covers everything". True for a tool that reads unfiltered by
 * default — and `pull_followups` is not one. `filtered` defaults to TRUE, so the
 * re-call still reads the Monitor view through whatever filter was persisted by
 * an earlier call. On a tenant carrying an old Paris filter, "leads across
 * France" would come back as the Paris cohort, described as the whole
 * workspace: a confident, plausible, wrong answer — the exact class this guard
 * exists to prevent, reached by following the guard's own advice.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory, getHttpRequests } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { pullFollowups } from "../../../src/composite/pull-followups.js";

const BASE = "https://api-fr.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "fr");

beforeEach(() => resetHttpMock());

describe("pull_followups country recovery covers the persisted filter", () => {
  it("tells the caller to pass filtered:false, not merely to omit city", async () => {
    mockHttp([]);
    const result = await pullFollowups.execute(newClient(), { city: "France" });

    expect(result.status).toBe("country_level_location");
    expect(result.hint).toMatch(/OMIT city/);
    expect(result.hint).toMatch(/`filtered` defaults to true/);
    expect(result.hint).toMatch(/filtered:false/);
    // The alternative — actually clearing the stored filter — is named too,
    // because a caller may want the filter gone rather than bypassed.
    expect(result.hint).toMatch(/set_filter:\{criteria:\[\]\}/);
    // And it points at the field that reports what was really applied.
    expect(result.hint).toMatch(/active_filters/);
  });

  it("still spends no HTTP proving it", async () => {
    mockHttp([]);
    await pullFollowups.execute(newClient(), { city: "France" });
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("does not attach the caveat to a foreign country", async () => {
    // "Canada" on FR must NOT be re-run unfiltered at all, so advice about how
    // to widen correctly would be advice to do the wrong thing thoroughly.
    mockHttp([]);
    const result = await pullFollowups.execute(newClient(), { city: "Canada" });
    expect(result.status).toBe("country_level_location");
    expect(result.hint).not.toMatch(/filtered:false/);
    expect(result.hint).toMatch(/does NOT answer a question about Canada/);
  });

  it("does not attach it to an excluded home country either", async () => {
    mockHttp([]);
    const result = await pullFollowups.execute(newClient(), {
      set_filter: {
        criteria: [{ type: "location_ids", is_excluded: true, locations: ["France"] }],
      },
    });
    expect(result.status).toBe("country_level_location");
    expect(result.hint).not.toMatch(/filtered:false/);
  });
});
