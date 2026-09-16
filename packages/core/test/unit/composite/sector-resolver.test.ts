// Locks the sector matcher (product#4140).
//
// The Leadbay API matches `filters.sectors` as an exact, case-sensitive label,
// so anything else is a 400 telling the caller not to retry. These cases fix
// what the MCP may fix silently and what it must hand back instead.
//
// The fixtures are real rows, trimmed, from prod on 2026-09-15:
//   GET /1.6/sectors/all?lang=en  — api-fr (SIRENE, 1368 rows)
//   GET /1.6/sectors/all?lang=en  — api-us (NAICS, 1091 rows)
//
// RED proof: matching on `row.name` (the field the taxonomy does NOT return)
// makes every resolution case fail, which is the shape product#4100 reported.

import { describe, it, expect } from "vitest";
import {
  matchSector,
  resolveSectorValues,
  sectorSections,
  sectorLabel,
  normalizeSectorText,
} from "../../../src/composite/_sector-resolver.js";

/** SIRENE, as api-fr serves it: `label`, never `name`. */
const FR = [
  { id: "3706", label: "Construction", number_of_leads: 783569, visible: true },
  { id: "3712", label: "Real estate activities", number_of_leads: 2561592 },
  { id: "3713", label: "Specialized, scientific, and technical activities", number_of_leads: 840992 },
  { id: "3714", label: "Administrative and support service activities", number_of_leads: 565425 },
  { id: "3719", label: "Other service activities", number_of_leads: 836546 },
  { id: "4090", parent: "3712", label: "Real estate agencies", number_of_leads: 120000 },
  { id: "4091", parent: "3712", label: "Real estate development", number_of_leads: 90000 },
  { id: "4300", parent: "3709", label: "Restaurants and mobile food services", number_of_leads: 220000 },
  { id: "4301", parent: "4300", label: "Fast food restaurant", number_of_leads: 40000 },
  { id: "4500", parent: "3703", label: "Manufacturing industry", number_of_leads: 373400 },
  { id: "4501", parent: "4500", label: "Manufacturing activities n.e.c. (not elsewhere classified)", number_of_leads: 900 },
];

/** NAICS, as api-us serves it. */
const US = [
  { id: "731", label: "Construction", number_of_leads: 60933 },
  { id: "2693", label: "Professional, Scientific and Technical Services", number_of_leads: 216833 },
  { id: "2857", parent: "2693", label: "All Other Professional, Scientific and Technical Services", number_of_leads: 153042 },
  { id: "2075", label: "Retail Trade", number_of_leads: 77638 },
  { id: "2100", parent: "2075", label: "Retail Bakeries", number_of_leads: 1200 },
  { id: "3290", label: "Other Services (except Public Administration)", number_of_leads: 31856 },
];

describe("sector matcher — what it may fix silently", () => {
  it("case and accents are spelling, not a different sector", () => {
    for (const written of ["Construction", "construction", "CONSTRUCTION", " construction "]) {
      const m = matchSector(written, FR);
      expect(m.kind).toBe("resolved");
      if (m.kind === "resolved") expect(m.label).toBe("Construction");
    }
    expect(normalizeSectorText("Activités spécialisées")).toBe("activites specialisees");
  });

  it("the registry's 'activities' suffix is not a different sector", () => {
    const m = matchSector("Real estate", FR);
    expect(m.kind).toBe("resolved");
    // Not "Real estate agencies" and not "Real estate development": those carry
    // a word the caller did not write.
    if (m.kind === "resolved") expect(m.label).toBe("Real estate activities");
  });

  it("an exact label is passed through untouched, so a working call keeps working", () => {
    const m = matchSector("Specialized, scientific, and technical activities", FR);
    expect(m.kind).toBe("resolved");
    if (m.kind === "resolved") {
      expect(m.label).toBe("Specialized, scientific, and technical activities");
      expect(m.exact).toBe(true);
    }
  });
});

describe("sector matcher — what it must never decide alone", () => {
  it("a word with no label anywhere comes back as a choice, not a guess", () => {
    const m = matchSector("Professional Services", FR);
    expect(m.kind).toBe("unresolved");
  });

  it("a partial overlap never resolves — it would silently narrow the ask", () => {
    // "Restaurant" is inside two labels; picking one fences the search to it.
    const m = matchSector("Restaurant", FR);
    expect(m.kind).toBe("unresolved");
    if (m.kind === "unresolved") {
      expect(m.candidates.map((c) => c.name)).toEqual([
        "Restaurants and mobile food services",
        "Fast food restaurant",
      ]);
    }
  });

  it("the registry's residual bucket never stands in for the whole sector", () => {
    // "n.e.c." is the leftovers of Manufacturing, not Manufacturing.
    const m = matchSector("Manufacturing", FR);
    expect(m.kind).toBe("unresolved");
    if (m.kind === "unresolved") {
      expect(m.candidates[0].name).toBe("Manufacturing industry");
    }
  });

  it("the broadest full match is offered first, so reading top-down never narrows", () => {
    const m = matchSector("Retail", US);
    expect(m.kind).toBe("unresolved");
    if (m.kind === "unresolved") {
      expect(m.candidates.map((c) => c.name)).toEqual(["Retail Trade", "Retail Bakeries"]);
    }
  });

  it("a word in no label at all still gets the sections to land on", () => {
    const m = matchSector("Gyms", FR);
    expect(m.kind).toBe("unresolved");
    if (m.kind === "unresolved") expect(m.candidates).toEqual([]);
    expect(sectorSections(FR)).toContain("Specialized, scientific, and technical activities");
  });
});

describe("sector matcher — taxonomy shape", () => {
  it("reads `label`, which is the only field the taxonomy returns", () => {
    expect(sectorLabel({ id: "1", label: "Construction" } as any)).toBe("Construction");
    // product#4100: reading `name` scored every row 0 and returned empty matches.
    expect(sectorLabel({ id: "1" } as any)).toBe("");
  });

  it("a null-label row is scanned without throwing", () => {
    const dirty = [...FR, { id: "9", label: null }, { id: "10" }] as any;
    expect(() => matchSector("Construction", dirty)).not.toThrow();
    expect(sectorSections(dirty)).not.toContain("");
  });

  it("sections are the registry roots, biggest first", () => {
    const sections = sectorSections(FR);
    expect(sections[0]).toBe("Real estate activities");
    expect(sections).not.toContain("Real estate agencies"); // has a parent
  });
});

describe("resolveSectorValues — the list actually sent to the API", () => {
  it("a numeric taxonomy id is passed through without touching the taxonomy", () => {
    const r = resolveSectorValues(["3713", " 3706 "], FR);
    expect(r.values).toEqual(["3713", "3706"]);
    expect(r.unresolved).toEqual([]);
    expect(r.rewritten).toEqual([]);
  });

  it("reports only the values whose spelling changed", () => {
    const r = resolveSectorValues(["construction", "Real estate activities"], FR);
    expect(r.values).toEqual(["Construction", "Real estate activities"]);
    expect(r.rewritten).toEqual([{ asked: "construction", used: "Construction" }]);
  });

  it("one unknown value among good ones is still reported, with the good ones kept", () => {
    const r = resolveSectorValues(["construction", "Professional Services"], FR);
    expect(r.rewritten).toEqual([{ asked: "construction", used: "Construction" }]);
    expect(r.unresolved.map((u) => u.asked)).toEqual(["Professional Services"]);
    expect(r.sections.length).toBe(5);
  });

  it("names the real label when the taxonomy has one — the US half of the same ask", () => {
    const r = resolveSectorValues(["Professional Services"], US);
    expect(r.unresolved[0].closest[0].name).toBe(
      "Professional, Scientific and Technical Services"
    );
  });
});
