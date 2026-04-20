/**
 * Contract tests — the single most valuable tests in the suite.
 *
 * Enforces manifest ↔ code parity. When a tool is added in src/ or removed
 * from openclaw.plugin.json, these fail with a named-diff error. No magic
 * tool counts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createTestApi } from "./harness.js";
import { register } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.resolve(__dirname, "..", "openclaw.plugin.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const WRITE_TOOLS = new Set([
  "leadbay_qualify_lead",
  "leadbay_enrich_contacts",
  "leadbay_add_note",
]);

describe("contract: manifest ↔ code parity", () => {
  it("registered tools match openclaw.plugin.json contracts.tools exactly", () => {
    const t = createTestApi({ region: "us" });
    register(t.api as any);

    const registered = new Set(t.tools.keys());
    const declared = new Set<string>(manifest.contracts.tools);

    const added = [...registered].filter((n) => !declared.has(n));
    const missing = [...declared].filter((n) => !registered.has(n));

    if (added.length || missing.length) {
      throw new Error(
        `Manifest drift.\n` +
          `  registered in code but MISSING from openclaw.plugin.json: [${added.join(
            ", "
          )}]\n` +
          `  declared in openclaw.plugin.json but NOT registered: [${missing.join(", ")}]\n` +
          `Fix: either update openclaw.plugin.json contracts.tools or delete the unregistered tool.`
      );
    }

    expect([...registered].sort()).toEqual([...declared].sort());
  });

  it("every registered tool has a valid JSON-schema parameters object", () => {
    const t = createTestApi({ region: "us" });
    register(t.api as any);

    for (const [name, tool] of t.tools) {
      expect(tool.parameters, `${name} parameters`).toBeTypeOf("object");
      const p = tool.parameters as any;
      expect(p.type, `${name}.parameters.type`).toBe("object");
      expect(p.properties, `${name}.parameters.properties`).toBeTypeOf("object");
    }
  });

  it("write tools are marked optional; read tools are not", () => {
    const t = createTestApi({ region: "us" });
    register(t.api as any);

    for (const [name, tool] of t.tools) {
      if (WRITE_TOOLS.has(name)) {
        expect(tool.optional, `write tool ${name} must be optional:true`).toBe(true);
      } else {
        expect(tool.optional, `read tool ${name} must NOT be optional`).not.toBe(true);
      }
    }
  });

  it("every registered tool has a non-empty description", () => {
    const t = createTestApi({ region: "us" });
    register(t.api as any);

    for (const [name, tool] of t.tools) {
      expect(tool.description, `${name}.description`).toBeTypeOf("string");
      expect((tool.description as string).length, `${name}.description length`).toBeGreaterThan(10);
    }
  });
});

describe("contract: register() behaviour", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits logger.warn and registers no tools when region+baseUrl missing", () => {
    const t = createTestApi({ region: "xx" }); // invalid region → no baseUrl lookup
    register(t.api as any);
    expect(t.tools.size).toBe(0);
    expect(t.logs.some((l) => l.level === "warn" && /region/i.test(l.msg))).toBe(true);
  });

  it("registers 11 tools when region=us (valid default)", () => {
    const t = createTestApi({ region: "us" });
    register(t.api as any);
    expect(t.tools.size).toBe(11);
  });

  it("calls client.setToken and logs info when cfg.token is provided", async () => {
    const clientModule = await import("../src/client.js");
    const spy = vi.spyOn(clientModule.LeadbayClient.prototype, "setToken");

    const t = createTestApi({ region: "us", token: "u.preconfig-token" });
    register(t.api as any);

    expect(spy).toHaveBeenCalledWith("u.preconfig-token");
    expect(t.logs.some((l) => l.level === "info" && /preconfigured/i.test(l.msg))).toBe(
      true
    );
  });

  it("manifest contracts.tools matches the openclaw.plugin.json schema", () => {
    // Sanity: manifest is a valid JSON schema shape
    expect(manifest.id).toBe("leadclaw");
    expect(manifest.configSchema).toBeTypeOf("object");
    expect(Array.isArray(manifest.contracts.tools)).toBe(true);
  });
});
