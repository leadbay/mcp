import { describe, it, expect } from "vitest";
import { ARTIFACT_USAGE_GUIDE as GUIDE } from "../../core/src/artifact-runtime.generated.js";

// The route planner opens on the workspace's country, fitted to the pane.
//
// Two bugs sit behind these rules. With Leaflet's default whole-step zoom,
// fitBounds settled one level short in the half-width pane, and the first fit
// could be taken from a frame the host had not sized yet — so the country
// opened small and every zoom tweak seemed to do nothing. And the recipe was
// France-only: a US workspace would have opened on France, pins over the
// Atlantic.

const opening = () =>
  GUIDE.slice(
    GUIDE.indexOf("### The board opens on the workspace's country"),
    GUIDE.indexOf("### The lead list"),
  );
const flat = () => opening().replace(/\s+/g, " ");

describe("the map picks the workspace's country", () => {
  it("has an outline and bounds for each region", () => {
    const o = opening();
    expect(o).toContain('fr: { file: "france-departements.json", bounds: FRANCE_BOUNDS');
    expect(o).toContain('us: { file: "us-states.json",           bounds: US_BOUNDS');
    expect(o).toContain("L.latLngBounds([24.5, -124.8], [49.4, -66.9])");
  });

  it("reads the region from _meta.region, with the leads' country as fallback", () => {
    expect(opening()).toContain("result?._meta?.region");
    expect(opening()).toContain("location?.country");
    expect(flat()).toMatch(/The country comes from `_meta\.region`, never an assumption/);
  });

  it("holds a neutral view until the region is known, and says why", () => {
    expect(opening()).toContain("map.setView([40, -30], 2)");
    expect(flat()).toMatch(/guessing France flashes the wrong country at every US rep/);
  });

  it("lists the US outline beside the French one", () => {
    const basemap = GUIDE.slice(GUIDE.indexOf("So the basemap is a **published file**"), GUIDE.indexOf("**Stop there.**"));
    expect(basemap).toContain("`us-states.json`");
    expect(basemap).toContain("US Census Bureau");
  });
});

describe("the country opens fitted to the pane", () => {
  it("creates the map with quarter zoom steps", () => {
    expect(opening()).toContain('L.map("map", { zoomSnap: 0.25 })');
  });

  it("says why, so the option is not dropped as noise", () => {
    expect(flat()).toMatch(/settles on the largest WHOLE zoom that still fits/);
  });

  it("opens exactly at the whole-country fit, not zoomed past it", () => {
    // Settled on the live planner after trying +2, +1.5, +1, +0.5 and +0.25:
    // each cropped the country and pushed a region's leads off the edge.
    expect(opening()).toContain("map.getBoundsZoom(region.bounds), o)");
    expect(opening()).not.toMatch(/getBoundsZoom\([^)]*\) \+/);
    expect(flat()).toMatch(/Just fitting, not zoomed in/);
  });

  it("re-frames on resize until the rep moves, and says why", () => {
    const o = opening();
    expect(o).toContain("map.invalidateSize({ pan: false })");
    expect(o).toContain("if (homeView) reframe({ animate: false })");
    expect(o).toContain('map.on("movestart", () => { if (!framing) homeView = false })');
    expect(flat()).toMatch(/sizes the artifact frame a beat AFTER the page runs/);
  });

  it("uses one showHome for every return to the country", () => {
    expect(flat()).toMatch(/One `showHome\(\)` for every return to the country/);
  });

  it("keeps the zoom buttons at whole steps", () => {
    expect(opening()).toContain("`zoomDelta` stays 1");
  });
});
