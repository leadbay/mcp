import { describe, it, expect } from "vitest";
import { ARTIFACT_USAGE_GUIDE as GUIDE } from "../../core/src/artifact-runtime.generated.js";

// The route planner's panel is a FIXED contract, like the lead card's.
//
// The first version of this recipe said "clicking a marker opens that lead in
// the panel with its actions" and named the tools. That is not a spec: it
// leaves the section list, their order and their controls to whoever builds
// the board, so two agents produce two panels and a rep who learned one
// cannot use the other. The whole point of a canonical recipe is that a rep
// meets the same board every time.
//
// These pin the five sections, their order, and the three rules that decide
// what goes in them.

const flat = GUIDE.replace(/\s+/g, " ");

const planner = () =>
  GUIDE.slice(
    GUIDE.indexOf("## Recipe: the ROUTE PLANNER"),
    GUIDE.indexOf("## Recipe: the LEAD DESK"),
  );

describe("the panel's sections are named and ordered", () => {
  it("states the order is fixed, not a starting point", () => {
    expect(flat).toMatch(/The panel is FIXED — same sections, same order, every time/i);
  });

  it("names all four, matching the shipped artifact", () => {
    const p = planner();
    for (const s of ["Status", "Prospecting action", "Log outreach", "Nearby follow-ups"]) {
      expect(p).toContain(s);
    }
  });

  it("puts them in the order a rep works them", () => {
    const p = planner();
    const order = ["<!-- 1.", "<!-- 2.", "<!-- 3.", "<!-- 4."].map((m) => p.indexOf(m));
    expect(order.every((i) => i > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("carries the head a rep reads before leaving the car", () => {
    // Taken from the shipped artifact, not invented: address, who to ask for,
    // a number for a locked door, and the two ways out of the page.
    const p = planner();
    expect(p).toContain("Locate on map");
    expect(p).toContain("Add to route");
    expect(p).toContain("Open in Leadbay");
    expect(p).toMatch(/No address on file/);
    expect(p).toMatch(/No contact yet — enrich to find one/);
  });

  it("labels the channels as the COMPANY's, not the contact's", () => {
    // phone_numbers / email on a lead are the switchboard. Unlabelled, the
    // rep dials it expecting the person whose name is on the line above.
    expect(planner()).toContain("Company line:");
    expect(flat).toMatch(/not the contact's direct line/i);
  });

  it("describes the OVERVIEW mode too, not just the selected lead", () => {
    // With nothing selected the panel is the route + the lead list; a recipe
    // that only specifies the detail leaves half the panel undefined.
    expect(flat).toMatch(/The panel has TWO modes/i);
    expect(planner()).toContain("Today's route");
  });

  it("explains WHY that order, so it is not reshuffled on taste", () => {
    expect(flat).toMatch(/\*\*status first\*\* because it is one click/i);
    expect(flat).toMatch(/on a doorstep "nobody in" is the whole report/i);
  });
});

describe("the rules that keep two panels the same", () => {
  it("keeps status and prospecting action as separate axes", () => {
    // The single most repeated mistake across every board in this kit.
    expect(flat).toMatch(/Status and prospecting action are DIFFERENT AXES/);
    expect(flat).toMatch(/Setting one never sets the other/);
  });

  it("pins the prospecting action as four BUTTONS, not a select", () => {
    // One tap in a car park; a dropdown costs two.
    expect(flat).toMatch(/four buttons, not a dropdown/i);
    expect(planner()).toContain("lb.EPILOGUE_STATUSES");
  });

  it("requires the pin to repaint before the panel claims success", () => {
    // The map is what the rep reads. A "saved" over a stale pin is a lie
    // about the thing in front of them.
    expect(flat).toMatch(/repaints the pin before the panel says "saved"/i);
  });

  it("sends an optional relanceRow to the END, never among the four", () => {
    expect(flat).toMatch(/as a FIFTH section after Nearby — never inserted among the four/i);
  });
});

describe("the recipe still carries the map-level rules", () => {
  it("keeps the half-map, half-panel shape", () => {
    expect(flat).toMatch(/Half map, half panel/i);
  });

  it("keeps the ungeocoded leads visible", () => {
    expect(flat).toMatch(/Ungeocoded leads are NORMAL — list them, never drop them/i);
  });

  it("keeps the 0,0 sentinel warning", () => {
    expect(flat).toMatch(/`0,0` is not a lead/i);
  });
});

// Three rules that were absent when the recipe first shipped, each added after
// the board in front of a user proved the recipe wrong. They are pinned here
// because every one of them is invisible until a rep opens the page: a guide
// that quietly loses them costs another round of the same debugging.

describe("Log outreach owns the note, never the epilogue", () => {
  it("does not describe an outcome control in the form", () => {
    // The first contract said "channel + outcome + note". That select carried
    // the same four EPILOGUE_STATUSES as the buttons above it, so two controls
    // wrote one field and the later write silently won.
    expect(planner()).not.toMatch(/LOG OUTREACH\s*—\s*channel \+ outcome/i);
    expect(planner()).toMatch(/LOG OUTREACH\s*—\s*channel \+ note, NO status/);
  });

  it("states the collision and what it looked like", () => {
    expect(flat).toMatch(/Log outreach writes a NOTE\. It must not offer the epilogue too/);
    expect(flat).toMatch(/two writes of one field and the second silently won/);
  });

  it("requires the panel to say the form sets no status", () => {
    expect(flat).toMatch(/Sets no status — use Prospecting action above for that/);
  });
});

describe("the board is pinned to light", () => {
  it("no longer claims the dark block can just be deleted", () => {
    // "the skin flips its own tokens, so aliases follow for free" is how a
    // dark-mode laptop got white text on a light ground.
    expect(flat).not.toMatch(/aliases follow for free/i);
  });

  it("warns that aliasing INHERITS the skin's dark mode", () => {
    expect(flat).toMatch(/accidentally immune to dark\s+mode/i);
    expect(flat).toMatch(/white text on a white page/i);
  });

  it("pins the tripled selector and says why source order forces it", () => {
    const p = planner();
    expect(p).toContain(":root:root:root");
    expect(flat).toMatch(/lb\.styles\(\) APPENDS the skin to <head> at runtime/);
    expect(flat).toMatch(/specificity instead, which source order cannot undo/);
  });

  it("names the simpler option and why an artifact cannot use it", () => {
    expect(flat).toMatch(/data-lb-theme="light".? on .?<html>.? does the same job/i);
    expect(flat).toMatch(/fragment the host wraps does not/i);
  });
});

describe("the geo helpers are required, not a suggestion", () => {
  it("forbids hand-rolled copies", () => {
    expect(flat).toMatch(/Use the kit's geo helpers — do NOT hand-roll them/);
  });

  it("names every helper the five rules depend on", () => {
    const p = planner();
    for (const fn of ["lb.leadPos", "lb.distanceKm", "lb.orderByProximity", "lb.routeUrl", "lb.routeDistanceKm"]) {
      expect(p).toContain(fn);
    }
  });

  it("says an old runtime is moved forward, not worked around", () => {
    // The shipped planner bundles 0.6.0, which predates all five. Private
    // copies are how that page ended up unable to receive a kit-level fix.
    expect(flat).toMatch(/landed after kit 0\.6\.0/);
    expect(flat).toMatch(/moved forward rather than given private copies/);
  });
});

describe("the lead list row is specified, not left to taste", () => {
  it("covers both lists with one row", () => {
    expect(flat).toMatch(/Both lists in the panel — \*Follow-ups on the map\* and \*Nearby follow-ups\* —\s+use the same row/);
  });

  it("forbids animating the divider, and says what that looked like", () => {
    // V8 of the shipped planner faded the lines around the hovered row. Two
    // rules then fought over each line and it flickered on every crossing.
    expect(flat).toMatch(/The divider never reacts to hover, and never animates/);
    expect(flat).toMatch(/two rules then fight over one line/i);
    expect(flat).toMatch(/\*\*Only the background moves\.\*\*/);
  });

  it("gives spacing as the fix rather than hiding lines", () => {
    expect(flat).toMatch(/Space the rows instead of hiding the line/);
    expect(planner()).toContain("gap: 2px");
    expect(flat).toMatch(/never shares an edge with a divider/);
  });

  it("insets the divider to the text, not the row", () => {
    expect(flat).toMatch(/The divider is inset to the text/);
    expect(planner()).toContain("inset-inline: 10px");
    expect(flat).toMatch(/starts reading as a rule across the panel/);
  });

  it("pins the between-rows selector over a last-child exception", () => {
    // A selector that cannot match the last row has no special case to forget.
    expect(planner()).toContain(".row-btn + .row-btn::before");
    expect(flat).toMatch(/not `?::after`? with a `?:last-child`?\s+exception/);
  });

  it("keeps the hover reachable by keyboard and respects reduced motion", () => {
    const p = planner();
    expect(p).toContain(":focus-visible");
    expect(p).toContain("prefers-reduced-motion");
  });
});

describe("the tile-layer trap is written down", () => {
  it("names the line an agent would otherwise write", () => {
    // Every Leaflet tutorial opens with this. Silence in the recipe means the
    // next agent ships it and the rep gets an empty grey rectangle.
    expect(planner()).toContain('L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png")');
    expect(flat).toMatch(/It does not work in an artifact, and it fails silently/);
  });

  it("says WHY, so it is not read as a style preference", () => {
    expect(flat).toMatch(/content security policy admits the page's own files/);
    expect(flat).toMatch(/OpenStreetMap, Carto, Stadia, MapTiler, all of them/);
  });

  it("scopes the failure to artifacts, not to the code", () => {
    // The same two lines are correct in the frontend. A rule stated without
    // its scope gets cargo-culted into pages where tiles work fine.
    expect(flat).toMatch(/property of WHERE the page runs, not of the code/);
    expect(flat).toMatch(/work in the Leadbay frontend and in a local/);
  });

  it("names the one basemap file, and says to stop there", () => {
    // Roads and town labels were built, shipped and then removed. The recipe
    // records that so the next agent does not spend an afternoon rebuilding
    // them and arriving at the same place.
    expect(planner()).toContain("france-departements.json");
    expect(flat).toMatch(/\*\*Stop there\.\*\*/);
    expect(flat).toMatch(/partial substitute for a thing an artifact\s+cannot have/);
  });

  it("answers a request for more map detail honestly", () => {
    expect(flat).toMatch(/Open in Google\s+Maps\* link is where navigation lives/);
  });

  it("does not let a reader think a bigger file would fix it", () => {
    expect(flat).toMatch(/4\.7 GB/);
    expect(flat).toMatch(/16 MB ceiling per artifact/);
  });

  it("holds the crow-flies caveat in place", () => {
    // Without roads or drive times the straight-line total is all this map
    // can honestly claim, so the recipe must keep saying so somewhere.
    expect(planner()).toMatch(/as the crow flies/);
  });
});

describe("the board opens on France", () => {
  it("fits bounds rather than guessing a zoom", () => {
    // The map pane is half the window, so one zoom number frames the country
    // differently on a laptop and a wide monitor.
    const p = planner();
    expect(p).toContain("FRANCE_BOUNDS");
    expect(p).toContain("L.latLngBounds([41.3, -5.2], [51.1, 9.6])");
    expect(flat).toMatch(/`fitBounds`, never `setView\(\[46\.6, 2\.4\], 6\)`/);
  });

  it("forbids auto-fitting to the leads on load", () => {
    // The obvious move. It opens the board on whichever region the rep's book
    // clusters in, and re-fires on every city change, yanking the view.
    expect(flat).toMatch(/Do NOT fit to the leads on load/);
    expect(flat).toMatch(/opens on whichever region the rep's\s+book happens to cluster in/);
  });

  it("puts the fit behind a button the rep presses", () => {
    expect(flat).toMatch(/Give them a \*\*Fit to leads\*\* button in the toolbar instead/);
    expect(flat).toMatch(/let the opening view be France every time/);
  });

  it("says what the button does with no geocoded leads", () => {
    expect(flat).toMatch(/falls back to France rather than doing nothing/);
  });
});
