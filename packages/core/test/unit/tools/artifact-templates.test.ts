/**
 * leadbay_get_artifact_runtime serves the FINISHED boards. Every user who asks
 * for a route planner or a triage board gets the approved page, published as
 * it is — not a fresh re-implementation of a recipe, which is where the
 * hardcoded France map, the stale outcome select and the "null" chip came from.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory, getHttpRequests } from "../../harness.js";

import { vi } from "vitest";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { artifactKit, TEMPLATE_NAMES } from "../../../src/tools/get-artifact-runtime.js";

const client = () => new LeadbayClient("https://api-fr.leadbay.app", "u.test-token", "fr");
const get = (template?: string) => artifactKit.execute(client(), template ? { template } : {}) as Promise<any>;

beforeEach(() => resetHttpMock());

describe("the kit serves finished boards", () => {
  it("offers exactly the route planner and the triage board", () => {
    expect([...TEMPLATE_NAMES].sort()).toEqual(["route_planner", "triage_board"]);
  });

  it("returns the page, its tools and how to publish it", async () => {
    mockHttp([]);
    const r = await get("route_planner");
    expect(r.template).toBe("route_planner");
    expect(r.html).toContain("<title>");
    expect(r.icon).toBe("map");
    expect(r.capabilities.mcp.servers[0].server).toBe("Leadbay");
    expect(r.instructions).toMatch(/Publish `html` AS IT IS/);
    expect(getHttpRequests()).toHaveLength(0);
  });

  it("declares every tool each page calls", async () => {
    mockHttp([]);
    for (const name of TEMPLATE_NAMES) {
      const r = await get(name);
      const called = new Set([...r.html.matchAll(/"(leadbay_[a-z_]+)"/g)].map((m: RegExpMatchArray) => m[1]));
      // The page script names the tools it calls; the kit runtime names others
      // it could call. Every one the PAGE uses must be in the manifest.
      const app = r.html.slice(r.html.lastIndexOf("<script>"));
      for (const tool of [...app.matchAll(/"(leadbay_[a-z_]+)"/g)].map((m: RegExpMatchArray) => m[1])) {
        expect(r.capabilities.mcp.servers[0].tools, `${name} calls ${tool}`).toContain(tool);
      }
      expect(called.size).toBeGreaterThan(0);
    }
  });

  it("inlines the current kit runtime once", async () => {
    mockHttp([]);
    const r = await get("triage_board");
    expect(r.html.match(/globalThis\.LeadbayArtifacts=/g)?.length ?? r.html.match(/LeadbayArtifacts/g)?.length).toBeGreaterThan(0);
    expect(r.html.match(/<\/script>/g)?.length).toBe(r.html.match(/<script>/g)?.length);
  });

  it("carries no one user's data — the pages load their own on open", async () => {
    mockHttp([]);
    const planner = await get("route_planner");
    const triage = await get("triage_board");
    expect(triage.html).not.toContain("__LEADS__");
    expect(triage.html).toContain("loadPage(0)");
    expect(planner.html).toContain('const ASK = "Route planner board"');
    expect(planner.html).not.toMatch(/fetch\(region\.file\)|france-departements\.json/);
    expect(planner.html).toContain('lb.call("leadbay_get_basemap"');
  });

  it("gives the route planner its one editable block, and says so", async () => {
    mockHttp([]);
    const r = await get("route_planner");
    expect(r.html).toContain('<script type="application/json" id="lb-board-config">{"city": ""}</script>');
    expect(r.instructions).toMatch(/The ONE edit allowed is the JSON inside/);
  });

  it("still serves the runtime and guide when no template is asked for", async () => {
    mockHttp([]);
    const r = await get();
    expect(typeof r.runtime).toBe("string");
    expect(typeof r.usage_guide).toBe("string");
    expect(r.html).toBeUndefined();
  });

  it("rejects an unknown template by name", async () => {
    mockHttp([]);
    await expect(get("lead_desk")).rejects.toThrow(/Unknown template: lead_desk/);
  });
});
