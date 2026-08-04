/**
 * Release gate for the MCP-first delivery tools.
 *
 * `/1.6/mcp/search`, `/1.6/mcp/qualify` and `/1.6/mcp/jobs/{id}` are live on
 * staging only — production returns 404. Until the backend ships, the three
 * tools must NOT appear on the default surface, or every user gets tools that
 * fail on their first call.
 *
 * The module reads the env var at import time, so each case re-imports with a
 * reset module registry rather than mutating a cached catalogue.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const DELIVERY_TOOLS = [
  "leadbay_find_new_leads",
  "leadbay_qualify_leads",
  "leadbay_lead_job_status",
];

const FLAG = "LEADBAY_MCP_LEAD_DELIVERY";

async function loadCatalogues(flag: string | undefined) {
  vi.resetModules();
  const previous = process.env[FLAG];
  if (flag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = flag;
  try {
    const mod = await import("../../src/index.js");
    return [
      ...mod.compositeReadTools,
      ...mod.compositeWriteTools,
    ].map((t) => t.name);
  } finally {
    if (previous === undefined) delete process.env[FLAG];
    else process.env[FLAG] = previous;
  }
}

beforeEach(() => vi.resetModules());

// Each case resets the module registry and re-imports the full core index, a
// large graph that can take >1s to re-evaluate — well past vitest's 5s default
// once a case does it twice.
describe("MCP-first delivery release gate", { timeout: 30_000 }, () => {
  it("hides all three tools by default", async () => {
    const names = await loadCatalogues(undefined);
    for (const tool of DELIVERY_TOOLS) {
      expect(names).not.toContain(tool);
    }
  });

  it("exposes all three when the flag is set to 1", async () => {
    const names = await loadCatalogues("1");
    for (const tool of DELIVERY_TOOLS) {
      expect(names).toContain(tool);
    }
  });

  it("treats any other flag value as off", async () => {
    const names = await loadCatalogues("true");
    for (const tool of DELIVERY_TOOLS) {
      expect(names).not.toContain(tool);
    }
  });

  it("keeps them registered for contract audits regardless of the gate", async () => {
    vi.resetModules();
    delete process.env[FLAG];
    const mod = await import("../../src/index.js");
    const audited = mod.mcpFirstDeliveryAllTools.map((t) => t.name);
    for (const tool of DELIVERY_TOOLS) {
      expect(audited).toContain(tool);
    }
  });

  it("does not disturb the rest of the catalogue", async () => {
    const gatedOff = await loadCatalogues(undefined);
    const gatedOn = await loadCatalogues("1");
    const difference = gatedOn.filter((n) => !gatedOff.includes(n)).sort();
    expect(difference).toEqual([...DELIVERY_TOOLS].sort());
  });
});
