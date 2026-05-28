/**
 * parseWriteEnv — tri-state semantics for LEADBAY_MCP_WRITE.
 *
 * 0.3.0 flips the default ON. The parser must treat unset/empty as ON,
 * recognize 0/false/no/off as OFF, recognize 1/true/yes/on as ON, and
 * warn on unrecognized values. Critically: 0.2.x's `=== "1"` semantics
 * meant `true`/`yes`/`on` were OFF; the new parser flips those to ON.
 * This is a deliberate behavior change called out in MIGRATION.md.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { parseWriteEnv } from "../../src/env.js";

const KEYS = ["LEADBAY_MCP_WRITE"];

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("parseWriteEnv — defaults", () => {
  it("returns true when LEADBAY_MCP_WRITE is unset", () => {
    expect(parseWriteEnv()).toBe(true);
  });

  it("returns true when LEADBAY_MCP_WRITE is empty string", () => {
    process.env.LEADBAY_MCP_WRITE = "";
    expect(parseWriteEnv()).toBe(true);
  });
});

describe("parseWriteEnv — explicit on values", () => {
  it.each(["1", "true", "yes", "on", "TRUE", "On", "Yes "])(
    "treats %s as ON",
    (v) => {
      process.env.LEADBAY_MCP_WRITE = v;
      expect(parseWriteEnv()).toBe(true);
    }
  );
});

describe("parseWriteEnv — explicit off values", () => {
  it.each(["0", "false", "no", "off", "FALSE", "Off", " 0 "])(
    "treats %s as OFF",
    (v) => {
      process.env.LEADBAY_MCP_WRITE = v;
      expect(parseWriteEnv()).toBe(false);
    }
  );
});

describe("parseWriteEnv — unrecognized values", () => {
  it("warns to stderr and defaults to ON for unknown values", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      process.env.LEADBAY_MCP_WRITE = "banana";
      expect(parseWriteEnv()).toBe(true);
      expect(
        stderr.mock.calls.some(([m]) => /not recognized.*ON/.test(String(m)))
      ).toBe(true);
    } finally {
      stderr.mockRestore();
    }
  });
});
