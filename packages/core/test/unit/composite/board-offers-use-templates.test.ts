/**
 * The next-step options that offer a board send the agent to the FINISHED
 * page, so tapping "Triage board" or "Route planner" gives every user the same
 * screen, not a re-implementation.
 */

import { describe, it, expect } from "vitest";
import { buildPullLeadsNextSteps } from "../../../src/composite/pull-leads.js";
import { buildFollowupNextSteps } from "../../../src/composite/pull-followups.js";
import { buildTourNextSteps } from "../../../src/composite/tour-plan.js";

const at = (lat: number, lng: number) => ({ location: { pos: [lat, lng] } });
const opt = (ns: any, label: string) => ns.options.find((o: any) => o.label === label);

describe("board offers name their template", () => {
  it("Triage board → template triage_board, published as it is", () => {
    const ns = buildPullLeadsNextSteps({ leadCount: 10, hasMore: true, nextPage: 1, computingWishlist: false });
    const d = opt(ns, "Triage board").description;
    expect(d).toContain('template "triage_board"');
    expect(d).toMatch(/publish its html as it is/);
    expect(d).toMatch(/do not restyle or rewrite the page/);
  });

  it("Route planner on a follow-up page → template route_planner", () => {
    const ns = buildFollowupNextSteps(10, false, null, false, 9);
    const d = opt(ns, "Route planner").description;
    expect(d).toContain('template "route_planner"');
    expect(d).toMatch(/publish its html as it is/);
  });

  it("Route planner after a tour → the template, with the city set in its config", () => {
    const ns = buildTourNextSteps([at(45.76, 4.83) as any], [], "Lyon");
    const d = ns!.options[0].description;
    expect(d).toContain('template "route_planner"');
    expect(d).toContain('setting "city" to "Lyon" in its lb-board-config block');
  });

  it("a tour with no city leaves the config alone", () => {
    const ns = buildTourNextSteps([at(45.76, 4.83) as any], [], null);
    expect(ns!.options[0].description).not.toMatch(/lb-board-config/);
  });
});
