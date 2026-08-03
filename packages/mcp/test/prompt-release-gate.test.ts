/**
 * The leadbay_new_leads prompt is gated with the tools it drives.
 *
 * Every step of that guided workflow calls leadbay_find_new_leads /
 * leadbay_qualify_leads / leadbay_lead_job_status. With the delivery gate off,
 * offering the prompt would start a flow whose every call is missing from
 * tools/list — so the prompt hides and reappears with them.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

const FLAG = "LEADBAY_MCP_LEAD_DELIVERY";
const GATED = "leadbay_new_leads";

async function promptNames(flag: string | undefined) {
  vi.resetModules();
  const previous = process.env[FLAG];
  if (flag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = flag;
  try {
    const mod = await import("../src/prompts.js");
    return {
      exposed: mod.listPrompts().map((p) => p.name),
      all: mod.listAllPrompts().map((p) => p.name),
    };
  } finally {
    if (previous === undefined) delete process.env[FLAG];
    else process.env[FLAG] = previous;
  }
}

afterEach(() => vi.resetModules());

describe("leadbay_new_leads prompt release gate", () => {
  it("is hidden by default", async () => {
    const { exposed } = await promptNames(undefined);
    expect(exposed).not.toContain(GATED);
  });

  it("is exposed when the delivery flag is on", async () => {
    const { exposed } = await promptNames("1");
    expect(exposed).toContain(GATED);
  });

  it("stays in the full catalogue for contract audits either way", async () => {
    const off = await promptNames(undefined);
    const on = await promptNames("1");
    expect(off.all).toContain(GATED);
    expect(on.all).toContain(GATED);
  });

  it("gates only that prompt", async () => {
    const off = await promptNames(undefined);
    const on = await promptNames("1");
    const difference = on.exposed.filter((n) => !off.exposed.includes(n));
    expect(difference).toEqual([GATED]);
  });
});
