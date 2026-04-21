/**
 * Contract tests for @leadbay/leadclaw — manifest ↔ code parity.
 *
 * v0.2.0 (post-autoplan):
 *   - Tool registration is gated by exposeGranular / exposeWrite plugin config.
 *   - The manifest declares the FULL set of tools the plugin can expose.
 *   - With both flags on, all manifest tools are registered. With both off,
 *     only login + composites (read+write) register.
 *   - Description-style enforcement: every tool description contains
 *     "When to use" and "When NOT to use" sections.
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
const pkgPath = path.resolve(__dirname, "..", "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

describe("contract: manifest ↔ code parity (full expose)", () => {
  it("with exposeGranular+exposeWrite, registered tools match manifest exactly", () => {
    const t = createTestApi({
      region: "us",
      exposeGranular: true,
      exposeWrite: true,
    });
    register(t.api as any);

    const registered = new Set(t.tools.keys());
    const declared = new Set<string>(manifest.contracts.tools);

    const added = [...registered].filter((n) => !declared.has(n));
    const missing = [...declared].filter((n) => !registered.has(n));

    if (added.length || missing.length) {
      throw new Error(
        `Manifest drift.\n` +
          `  registered in code but MISSING from openclaw.plugin.json: [${added.join(", ")}]\n` +
          `  declared in openclaw.plugin.json but NOT registered: [${missing.join(", ")}]\n` +
          `Fix: either update openclaw.plugin.json contracts.tools or delete the unregistered tool.`
      );
    }

    expect([...registered].sort()).toEqual([...declared].sort());
  });

  it("every registered tool has a valid JSON-schema parameters object", () => {
    const t = createTestApi({
      region: "us",
      exposeGranular: true,
      exposeWrite: true,
    });
    register(t.api as any);

    for (const [name, tool] of t.tools) {
      expect(tool.parameters, `${name} parameters`).toBeTypeOf("object");
      const p = tool.parameters as any;
      expect(p.type, `${name}.parameters.type`).toBe("object");
      expect(p.properties, `${name}.parameters.properties`).toBeTypeOf("object");
    }
  });

  it("every registered tool has a non-empty description", () => {
    const t = createTestApi({
      region: "us",
      exposeGranular: true,
      exposeWrite: true,
    });
    register(t.api as any);

    for (const [name, tool] of t.tools) {
      expect(tool.description, `${name}.description`).toBeTypeOf("string");
      expect(
        (tool.description as string).length,
        `${name}.description length`
      ).toBeGreaterThan(10);
    }
  });

  // Per autoplan §C item 25: enforce the tool-description style.
  // Every description must include both "When to use" and "When NOT to use"
  // so the model has a clear positive AND negative trigger.
  it("every tool description contains both 'When to use' and 'When NOT to use' sections", () => {
    const t = createTestApi({
      region: "us",
      exposeGranular: true,
      exposeWrite: true,
    });
    register(t.api as any);

    const offenders: Array<{ name: string; missing: string[] }> = [];
    for (const [name, tool] of t.tools) {
      const desc = tool.description as string;
      const missing: string[] = [];
      if (!/when\s+to\s+use/i.test(desc)) missing.push("When to use");
      if (!/when\s+not\s+to\s+use/i.test(desc)) missing.push("When NOT to use");
      if (missing.length) offenders.push({ name, missing });
    }

    if (offenders.length) {
      const lines = offenders.map((o) => `  - ${o.name}: missing [${o.missing.join(", ")}]`);
      throw new Error(
        `${offenders.length} tool(s) missing required description sections:\n${lines.join("\n")}\n` +
          `Every tool description must include both 'When to use' and 'When NOT to use' so the LLM has a clear positive AND negative trigger.`
      );
    }
  });

  it("manifest has expected top-level shape", () => {
    expect(manifest.id).toBe("leadclaw");
    expect(manifest.version).toBe(pkg.version);
    expect(manifest.configSchema).toBeTypeOf("object");
    expect(Array.isArray(manifest.contracts.tools)).toBe(true);
  });

  it("manifest declares the agent-facing config flags", () => {
    expect(manifest.configSchema.properties.exposeGranular).toBeDefined();
    expect(manifest.configSchema.properties.exposeWrite).toBeDefined();
    expect(manifest.uiHints.exposeGranular).toBeDefined();
    expect(manifest.uiHints.exposeWrite).toBeDefined();
  });
});

describe("contract: register() gating", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("with no expose flags, registers ONLY login + composite READ tools", () => {
    const t = createTestApi({ region: "us" });
    register(t.api as any);

    const names = [...t.tools.keys()];
    // Must include login + composite reads.
    expect(names).toContain("leadbay_login");
    expect(names).toContain("leadbay_pull_leads");
    expect(names).toContain("leadbay_research_lead");
    expect(names).toContain("leadbay_account_status");
    expect(names).toContain("leadbay_recall_ordered_titles");
    expect(names).toContain("leadbay_research_company");
    expect(names).toContain("leadbay_prepare_outreach");
    // Must NOT include composite WRITE tools without exposeWrite.
    expect(names).not.toContain("leadbay_bulk_qualify_leads");
    expect(names).not.toContain("leadbay_enrich_titles");
    expect(names).not.toContain("leadbay_adjust_audience");
    expect(names).not.toContain("leadbay_refine_prompt");
    expect(names).not.toContain("leadbay_answer_clarification");
    expect(names).not.toContain("leadbay_report_outreach");
    // Must NOT include granular tools.
    expect(names).not.toContain("leadbay_get_lens_filter");
    expect(names).not.toContain("leadbay_select_leads");
    expect(names).not.toContain("leadbay_set_user_prompt");
  });

  it("with exposeWrite only, registers composite writes (NOT granulars)", () => {
    const t = createTestApi({ region: "us", exposeWrite: true });
    register(t.api as any);

    const names = [...t.tools.keys()];
    // Composite writes now visible.
    expect(names).toContain("leadbay_report_outreach");
    expect(names).toContain("leadbay_refine_prompt");
    expect(names).toContain("leadbay_answer_clarification");
    expect(names).toContain("leadbay_adjust_audience");
    expect(names).toContain("leadbay_bulk_qualify_leads");
    expect(names).toContain("leadbay_enrich_titles");
    // Granulars still hidden.
    expect(names).not.toContain("leadbay_get_lens_filter");
    expect(names).not.toContain("leadbay_set_user_prompt");
  });

  it("with exposeGranular only, registers granular READS but not any writes", () => {
    const t = createTestApi({ region: "us", exposeGranular: true });
    register(t.api as any);

    const names = [...t.tools.keys()];
    expect(names).toContain("leadbay_get_lens_filter");
    expect(names).toContain("leadbay_get_user_prompt");
    expect(names).toContain("leadbay_list_sectors");
    // Composite writes still hidden (exposeWrite is independent).
    expect(names).not.toContain("leadbay_report_outreach");
    expect(names).not.toContain("leadbay_refine_prompt");
    // Granular writes still hidden.
    expect(names).not.toContain("leadbay_select_leads");
    expect(names).not.toContain("leadbay_set_user_prompt");
    expect(names).not.toContain("leadbay_launch_bulk_enrichment");
  });

  it("with both expose flags, registers everything in the manifest", () => {
    const t = createTestApi({
      region: "us",
      exposeGranular: true,
      exposeWrite: true,
    });
    register(t.api as any);

    const names = new Set(t.tools.keys());
    for (const declared of manifest.contracts.tools as string[]) {
      expect(names.has(declared), `manifest tool not registered: ${declared}`).toBe(true);
    }
  });

  it("emits logger.warn and registers no tools when region is invalid", () => {
    const t = createTestApi({ region: "xx" });
    register(t.api as any);
    expect(t.tools.size).toBe(0);
    expect(t.logs.some((l) => l.level === "warn" && /region/i.test(l.msg))).toBe(
      true
    );
  });

  it("logs info when cfg.token is provided (preconfigured)", async () => {
    const t = createTestApi({ region: "us", token: "u.preconfig-token" });
    register(t.api as any);

    expect(
      t.logs.some((l) => l.level === "info" && /preconfigured/i.test(l.msg))
    ).toBe(true);
  });
});
