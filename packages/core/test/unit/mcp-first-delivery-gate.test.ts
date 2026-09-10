/**
 * The MCP-first delivery tools ship UNGATED.
 *
 * `/1.6/mcp/search`, `/1.6/mcp/qualify` and `/1.6/mcp/jobs/{id}` reached
 * production in backend v3.22.0 (2026-08-22) and were verified live on both
 * regions, so the opt-in `LEADBAY_MCP_LEAD_DELIVERY` flag that held these three
 * back is gone.
 *
 * This file used to assert the gate. It now asserts its absence, because the
 * removal has a failure mode the deletion alone would not catch: a stale
 * `LEADBAY_MCP_LEAD_DELIVERY=0` left in a user's Claude Desktop config, a
 * Docker env file, or a CI job from the gated era must NOT be able to take the
 * tools away again.
 *
 * The module reads env at import time, so each case re-imports with a reset
 * module registry rather than mutating a cached catalogue.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const DELIVERY_TOOLS = [
  "leadbay_find_new_leads",
  "leadbay_qualify_leads",
  "leadbay_lead_job_status",
];

const RETIRED_FLAG = "LEADBAY_MCP_LEAD_DELIVERY";

async function loadCatalogues(flag: string | undefined) {
  vi.resetModules();
  const previous = process.env[RETIRED_FLAG];
  if (flag === undefined) delete process.env[RETIRED_FLAG];
  else process.env[RETIRED_FLAG] = flag;
  try {
    const mod = await import("../../src/index.js");
    return [...mod.compositeReadTools, ...mod.compositeWriteTools].map(
      (t) => t.name
    );
  } finally {
    if (previous === undefined) delete process.env[RETIRED_FLAG];
    else process.env[RETIRED_FLAG] = previous;
  }
}

beforeEach(() => vi.resetModules());

// Each case resets the module registry and re-imports the full core index, a
// large graph that can take >1s to re-evaluate — well past vitest's 5s default
// once a case does it twice.
describe("MCP-first delivery tools are exposed by default", { timeout: 30_000 }, () => {
  it("registers all three with no env var set", async () => {
    const names = await loadCatalogues(undefined);
    for (const tool of DELIVERY_TOOLS) {
      expect(names).toContain(tool);
    }
  });

  it("splits them across the read and write surfaces", async () => {
    vi.resetModules();
    delete process.env[RETIRED_FLAG];
    const mod = await import("../../src/index.js");
    // lead_job_status is a read-only snapshot of a backend-owned job; the two
    // submitters can bill, so they must stay write-tier and disappear on a
    // LEADBAY_MCP_WRITE=0 deployment.
    expect(mod.compositeReadTools.map((t) => t.name)).toContain(
      "leadbay_lead_job_status"
    );
    const writes = mod.compositeWriteTools.map((t) => t.name);
    expect(writes).toContain("leadbay_find_new_leads");
    expect(writes).toContain("leadbay_qualify_leads");
    expect(writes).not.toContain("leadbay_lead_job_status");
  });

  it.each(["0", "1", "true", "", "off"])(
    "a leftover %s in the retired flag cannot hide them",
    async (value) => {
      const names = await loadCatalogues(value);
      for (const tool of DELIVERY_TOOLS) {
        expect(names).toContain(tool);
      }
    }
  );

  it("keeps them in the audit catalogue too", async () => {
    vi.resetModules();
    delete process.env[RETIRED_FLAG];
    const mod = await import("../../src/index.js");
    const audited = mod.mcpFirstDeliveryAllTools.map((t) => t.name);
    for (const tool of DELIVERY_TOOLS) {
      expect(audited).toContain(tool);
    }
  });

  it("exposes the same catalogue whatever the retired flag says", async () => {
    const withoutFlag = await loadCatalogues(undefined);
    const withFlag = await loadCatalogues("1");
    expect(withFlag.sort()).toEqual(withoutFlag.sort());
  });
});
