/**
 * leadbay_new_leads is gated by the WRITE SURFACE only.
 *
 * The rollout half of this gate is gone: the /1.6/mcp/* routes shipped in
 * backend v3.22.0 (2026-08-22), so `LEADBAY_MCP_LEAD_DELIVERY` is retired and
 * the prompt is offered by default.
 *
 * What survives is the half that is still load-bearing. Every phase of the
 * workflow calls leadbay_find_new_leads / leadbay_qualify_leads, which are
 * write-tier — so on a read-only server (LEADBAY_MCP_WRITE=0) the prompt must
 * still hide, or a user starts a guided flow whose every call is missing from
 * tools/list.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

const RETIRED_FLAG = "LEADBAY_MCP_LEAD_DELIVERY";
const PROMPT = "leadbay_new_leads";

async function promptNames(
  flag: string | undefined,
  opts: { includeWrite?: boolean } = {}
) {
  vi.resetModules();
  const previous = process.env[RETIRED_FLAG];
  if (flag === undefined) delete process.env[RETIRED_FLAG];
  else process.env[RETIRED_FLAG] = flag;
  try {
    const mod = await import("../src/prompts.js");
    return {
      exposed: mod.listPrompts(opts).map((p) => p.name),
      all: mod.listAllPrompts().map((p) => p.name),
    };
  } finally {
    if (previous === undefined) delete process.env[RETIRED_FLAG];
    else process.env[RETIRED_FLAG] = previous;
  }
}

afterEach(() => vi.resetModules());

describe("leadbay_new_leads prompt exposure", { timeout: 30_000 }, () => {
  it("is offered by default", async () => {
    const { exposed } = await promptNames(undefined);
    expect(exposed).toContain(PROMPT);
  });

  it.each(["0", "1", "", "off"])(
    "a leftover %s in the retired flag cannot hide it",
    async (value) => {
      const { exposed } = await promptNames(value);
      expect(exposed).toContain(PROMPT);
    }
  );

  it("hides on a read-only server", async () => {
    const { exposed } = await promptNames(undefined, { includeWrite: false });
    expect(exposed).not.toContain(PROMPT);
  });

  it("is the only prompt the write surface gates", async () => {
    const write = await promptNames(undefined);
    const readOnly = await promptNames(undefined, { includeWrite: false });
    const difference = write.exposed.filter((n) => !readOnly.exposed.includes(n));
    expect(difference).toEqual([PROMPT]);
  });

  it("stays in the full catalogue for contract audits either way", async () => {
    const write = await promptNames(undefined);
    const readOnly = await promptNames(undefined, { includeWrite: false });
    expect(write.all).toContain(PROMPT);
    expect(readOnly.all).toContain(PROMPT);
  });

  it("prompts/get refuses it on a read-only server, not just prompts/list", async () => {
    // A cached slash command bypasses the list entirely, so the gate has to
    // live in getPrompt too. Reads options at CALL time, hence the import and
    // the call inside one helper.
    const call = async (opts: { includeWrite?: boolean } = {}) => {
      vi.resetModules();
      const mod = await import("../src/prompts.js");
      try {
        mod.getPrompt(PROMPT, {}, opts);
        return null;
      } catch (err) {
        return String(err);
      }
    };

    expect(await call({ includeWrite: false })).toMatch(/not enabled/i);
    expect(await call()).toBeNull();
  });

  it("no longer tells the user to set a retired env var", async () => {
    vi.resetModules();
    const mod = await import("../src/prompts.js");
    let message = "";
    try {
      mod.getPrompt(PROMPT, {}, { includeWrite: false });
    } catch (err) {
      message = String(err);
    }
    expect(message).not.toContain(RETIRED_FLAG);
    expect(message).toContain("LEADBAY_MCP_WRITE");
  });
});
