import { describe, it, expect } from "vitest";
import { buildTourNextSteps } from "../../../src/composite/tour-plan.js";

// On an MCP Apps host (ChatGPT, …) a tour's "Route planner" step told the
// agent to call leadbay_get_artifact_runtime and publish the page — an
// artifact the host cannot publish, so the map never opened. There the
// planner is the board leadbay_followups_map opens: the step calls that.
// Claude keeps the artifact path, unchanged.

const at = (lat: number, lng: number) => ({ location: { pos: [lat, lng] } });

describe("tour_plan's Route planner step on an MCP Apps host", () => {
  it("calls leadbay_followups_map with the tour's city, not the artifact kit", () => {
    const ns = buildTourNextSteps([at(45.76, 4.83)], [], "Lyon", { apps: true })!;
    const step = ns.options[0];
    expect(step.label).toBe("Route planner");
    expect(step.kind).toBe("open_board");
    expect(step.description).toContain('Call leadbay_followups_map with city "Lyon"');
    expect(step.description).toContain("Do NOT call leadbay_get_artifact_runtime");
    expect(step.description).not.toMatch(/publish its html/);
  });

  it("passes the resolved city_id when the tour used one", () => {
    const ns = buildTourNextSteps([at(45.76, 4.83)], [], "Lyon", { apps: true, cityId: "4321" })!;
    expect(ns.options[0].description).toContain('Call leadbay_followups_map with city_id "4321"');
  });

  it("offers no artifact-only step there (no lead desk)", () => {
    const ns = buildTourNextSteps([at(45.76, 4.83)], [at(45.7, 4.8)], "Lyon", { apps: true })!;
    expect(ns.options.map((o) => o.label)).toEqual(["Route planner", "Prep outreach"]);
    expect(ns.options.some((o) => o.kind === "build_artifact")).toBe(false);
  });

  it("is still null when the tour found nothing", () => {
    expect(buildTourNextSteps([], [], "Lyon", { apps: true })).toBeNull();
  });
});

describe("tour_plan's steps on Claude are unchanged", () => {
  it("default: the artifact template, with the city in its config", () => {
    const ns = buildTourNextSteps([at(45.76, 4.83)], [], "Lyon")!;
    expect(ns.options[0].kind).toBe("build_artifact");
    expect(ns.options[0].description).toContain('template "route_planner"');
    expect(ns.options[0].description).toContain('setting "city" to "Lyon"');
  });

  it("apps:false is the same as the default", () => {
    expect(buildTourNextSteps([at(45.76, 4.83)], [], "Lyon", { apps: false })).toEqual(
      buildTourNextSteps([at(45.76, 4.83)], [], "Lyon"),
    );
  });
});
