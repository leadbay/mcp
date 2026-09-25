import { describe, it, expect } from "vitest";
import { buildFollowupNextSteps, isMappable } from "../../../src/composite/pull-followups.js";
import { buildTourNextSteps } from "../../../src/composite/tour-plan.js";

// The route planner is the board for leads worked in person. Two doors:
//
//   leadbay_tour_plan — "who can I see in Lyon" — had NO next_steps at all,
//   answering the most unambiguous travel intent in the product with two
//   lists and nothing to do with them. The planner leads there, ungated:
//   reaching that tool IS the intent.
//
//   leadbay_pull_followups (and leadbay_followups_map, which delegates to it
//   verbatim) — the menu is already full at four, two slots on boards. So the
//   planner SWAPS with the sector board on a geo-dense page: both answer
//   "what shape is my book", and only one tells a rep what order to drive.
//
// The swap is gated on the PAGE, never the account. The last offer gated here
// stayed suppressed indefinitely for an account whose server-stored filter
// survived sessions, which is why pull-followups-coverage-offer.test.ts is
// titled "the coverage board is ALWAYS on the menu".

const at = (lat: number, lng: number) => ({ location: { pos: [lat, lng] } });
const nowhere = () => ({ location: {} });

const opt = (ns: ReturnType<typeof buildFollowupNextSteps>, label: string) =>
  ns?.options.find((o) => o.label === label);

describe("isMappable knows what can go on a map", () => {
  it("accepts real coordinates", () => {
    expect(isMappable(at(45.764, 4.8357))).toBe(true);
  });

  it("rejects 0,0 — the API's sentinel, not the Gulf of Guinea", () => {
    expect(isMappable(at(0, 0))).toBe(false);
  });

  it("rejects missing, malformed and out-of-range positions", () => {
    expect(isMappable(nowhere())).toBe(false);
    expect(isMappable({})).toBe(false);
    expect(isMappable(null)).toBe(false);
    expect(isMappable({ location: { pos: ["45", "4"] } })).toBe(false);
    expect(isMappable({ location: { pos: [91, 0] } })).toBe(false);
  });
});

describe("a geo-dense followups page offers the route planner", () => {
  const ns = buildFollowupNextSteps(10, false, null, false, 9);

  it("takes the sector board's slot rather than adding a fifth option", () => {
    expect(opt(ns, "Route planner")).toBeDefined();
    expect(opt(ns, "Coverage board")).toBeUndefined();
    expect(ns!.options.filter((o) => o.kind === "build_artifact")).toHaveLength(2);
  });

  it("names the tool and the recipe", () => {
    const d = opt(ns, "Route planner")!.description;
    expect(d).toContain("leadbay_get_artifact_runtime");
    expect(d).toMatch(/ROUTE PLANNER recipe/);
  });

  it("describes the half-map, half-list shape the rep asked for", () => {
    const d = opt(ns, "Route planner")!.description;
    expect(d).toMatch(/map on one half/i);
    expect(d).toMatch(/clicking a marker/i);
  });

  it("says the ungeocoded leads go beside the map, not in the bin", () => {
    // A map showing 12 of 40 leads tells the rep their book is small.
    expect(opt(ns, "Route planner")!.description).toMatch(/rather than dropping them/i);
  });

  it("carries the count, so the rep knows how much of the page is placeable", () => {
    expect(opt(ns, "Route planner")!.description).toContain("9 of these 10");
  });
});

describe("the sector board keeps its slot everywhere else", () => {
  it("a page with few coordinates is not offered a route", () => {
    const ns = buildFollowupNextSteps(10, false, null, false, 3);
    expect(opt(ns, "Route planner")).toBeUndefined();
    expect(opt(ns, "Coverage board")).toBeDefined();
  });

  it("an unmeasured page keeps the sector board — omitted means unknown", () => {
    const ns = buildFollowupNextSteps(10, false, null, false);
    expect(opt(ns, "Route planner")).toBeUndefined();
    expect(opt(ns, "Coverage board")).toBeDefined();
  });

  it("exactly at the threshold, the route wins", () => {
    expect(opt(buildFollowupNextSteps(10, false, null, false, 6), "Route planner")).toBeDefined();
    expect(opt(buildFollowupNextSteps(10, false, null, false, 5), "Coverage board")).toBeDefined();
  });

  it("the menu stays inside the widget's bounds either way", () => {
    const ns = buildFollowupNextSteps(10, true, 1, true, 10);
    expect(ns!.options.length).toBeLessThanOrEqual(4);
    expect(ns!.options.length).toBeGreaterThanOrEqual(2);
  });
});

describe("a tour plan leads with the route planner, ungated", () => {
  const monitor = [at(45.76, 4.83), at(45.77, 4.84)];
  const discover = [at(45.75, 4.85)];

  it("offers it first", () => {
    const ns = buildTourNextSteps(monitor, discover, "Lyon");
    expect(ns!.options[0].label).toBe("Route planner");
    expect(ns!.options[0].kind).toBe("build_artifact");
  });

  it("names the city the rep asked about", () => {
    expect(buildTourNextSteps(monitor, discover, "Lyon")!.options[0].description).toContain(
      "in Lyon",
    );
  });

  it("offers it even when nothing is geocoded — the intent is the gate", () => {
    // Unlike a plain followups page: asking for a tour IS travel intent, so
    // the answer is a route with a caveat, not a sector chart.
    const ns = buildTourNextSteps([nowhere(), nowhere()], [], "Lyon");
    expect(ns!.options[0].label).toBe("Route planner");
    expect(ns!.options[0].description).toMatch(/2 have no coordinates/);
  });

  it("counts both halves of the tour", () => {
    expect(buildTourNextSteps(monitor, discover, null)!.options[0].description).toContain(
      "3 leads",
    );
  });

  it("offers the desk only when there are follow-ups to work by phone", () => {
    expect(opt(buildTourNextSteps(monitor, discover, "Lyon"), "Contact and outreach")).toBeDefined();
    // A tour that found only fresh Discover leads has no history to work.
    expect(opt(buildTourNextSteps([], discover, "Lyon"), "Contact and outreach")).toBeUndefined();
  });

  it("offers nothing for a tour that found no leads", () => {
    expect(buildTourNextSteps([], [], "Lyon")).toBeNull();
  });

  it("stays inside the widget's bounds", () => {
    const ns = buildTourNextSteps(monitor, discover, "Lyon");
    expect(ns!.options.length).toBeLessThanOrEqual(4);
    expect(ns!.options.length).toBeGreaterThanOrEqual(2);
  });
});
