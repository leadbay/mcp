import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ARTIFACT_USAGE_GUIDE as GUIDE } from "../../core/src/artifact-runtime.generated.js";

// The two approved boards ship FINISHED. The guide must send agents to the
// template rather than let them rebuild it from the recipe, and the template
// sources must be the ones the kit builds from.

const src = (p: string) => fileURLToPath(new URL("../src/" + p, import.meta.url));
const flat = GUIDE.replace(/\s+/g, " ");

describe("the guide sends agents to the finished boards", () => {
  it("marks the triage board as served finished", () => {
    const r = GUIDE.slice(GUIDE.indexOf("## Recipe: the pull-leads triage board"), GUIDE.indexOf("## Recipe: the ROUTE PLANNER"));
    expect(r).toContain('`template: "triage_board"`');
    expect(r).toContain("Served finished — do not build this by hand.");
  });

  it("marks the route planner as served finished, with its one editable block", () => {
    const r = GUIDE.slice(GUIDE.indexOf("## Recipe: the ROUTE PLANNER"), GUIDE.indexOf("## Recipe: the LEAD DESK"));
    expect(r).toContain('`template: "route_planner"`');
    expect(r).toContain('<script id="lb-board-config">');
  });

  it("says changes go in the template source, not a re-implementation", () => {
    expect(flat).toMatch(/Changes to the board are made in the template source/);
  });

  it("is honest that the triage template only fits the Discover batch", () => {
    expect(flat).toMatch(/the template does not fit yet — it loads the Discover batch/);
  });
});

describe("the template sources are in the kit", () => {
  const defs = JSON.parse(readFileSync(src("templates/templates.json"), "utf8"));

  it("lists each template with its page and script", () => {
    for (const [name, def] of Object.entries<any>(defs)) {
      expect(existsSync(src(`templates/${def.dir}/page.html`)), `${name} page.html`).toBe(true);
      expect(existsSync(src(`templates/${def.dir}/app.js`)), `${name} app.js`).toBe(true);
    }
  });

  it("ships an outline for each region a workspace can be in", () => {
    expect(existsSync(src("basemaps/fr.json"))).toBe(true);
    expect(existsSync(src("basemaps/us.json"))).toBe(true);
  });

  it("keeps each page's title short enough to name the artifact", () => {
    for (const def of Object.values<any>(defs)) {
      const page = readFileSync(src(`templates/${def.dir}/page.html`), "utf8");
      const title = page.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
      expect(title.split(/\s+/).length).toBeLessThanOrEqual(4);
    }
  });
});
