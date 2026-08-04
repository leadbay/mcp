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

async function promptNames(
  flag: string | undefined,
  opts: { includeWrite?: boolean } = {}
) {
  vi.resetModules();
  const previous = process.env[FLAG];
  if (flag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = flag;
  try {
    const mod = await import("../src/prompts.js");
    return {
      exposed: mod.listPrompts(opts).map((p) => p.name),
      all: mod.listAllPrompts().map((p) => p.name),
      get: (name: string) => mod.getPrompt(name, {}, opts),
    };
  } finally {
    if (previous === undefined) delete process.env[FLAG];
    else process.env[FLAG] = previous;
  }
}

afterEach(() => vi.resetModules());

describe("leadbay_new_leads prompt release gate", { timeout: 30_000 }, () => {
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

  it("stays hidden on a read-only server even with the flag on", async () => {
    // Every phase calls write-tier delivery tools, so LEADBAY_MCP_WRITE=0
    // leaves the workflow unrunnable regardless of the rollout flag.
    const { exposed } = await promptNames("1", { includeWrite: false });
    expect(exposed).not.toContain(GATED);
  });

  it("prompts/get refuses a gated prompt, not just prompts/list", async () => {
    // A cached slash command bypasses the list entirely. The gate reads the
    // env at CALL time, so each case must assert while its flag is still set —
    // hence the calls live inside the helper rather than on a returned closure.
    const call = async (
      flag: string | undefined,
      opts: { includeWrite?: boolean } = {}
    ) => {
      vi.resetModules();
      const previous = process.env[FLAG];
      if (flag === undefined) delete process.env[FLAG];
      else process.env[FLAG] = flag;
      try {
        const mod = await import("../src/prompts.js");
        try {
          mod.getPrompt(GATED, {}, opts);
          return null;
        } catch (err) {
          return String(err);
        }
      } finally {
        if (previous === undefined) delete process.env[FLAG];
        else process.env[FLAG] = previous;
      }
    };

    expect(await call(undefined)).toMatch(/not enabled/i);
    expect(await call("1", { includeWrite: false })).toMatch(/not enabled/i);
    expect(await call("1")).toBeNull();
  });
});
