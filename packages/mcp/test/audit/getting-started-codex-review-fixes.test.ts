/**
 * Audit: the eight review findings raised against the getting-started
 * walkthrough after it first landed (leadbay/mcp#175, backed out by #176).
 *
 * Each `it` below pins ONE finding so the exact regression cannot come back.
 * They are deliberately in a new file rather than folded into
 * getting-started-walkthrough.test.ts — that file pins the walkthrough's own
 * contract; this one pins the corrections.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { GETTING_STARTED_MANIFEST, gettingStarted, compositeWriteTools } from "@leadbay/core";
import type { LeadbayClient } from "@leadbay/core";
import { leadbay_getting_started as BODY } from "../../src/prompts.generated.js";

const REPO_ROOT = resolve(__dirname, "../../../..");
const WORKFLOWS = readFileSync(resolve(REPO_ROOT, "WORKFLOWS.md"), "utf8");

const gate4 = GETTING_STARTED_MANIFEST.steps.find((s) => s.n === 4)!;

describe("audit: getting-started review fixes", () => {
  // ── P1 — the paid reveal must be scoped to the ONE drafted lead ───────────
  it("the paid reveal names `leadIds` (array), never a singular `leadId`", async () => {
    // leadbay_enrich_titles reads `leadIds?: string[]` ONLY. A singular
    // `leadId` is silently dropped, and with no leadIds the tool falls back to
    // the top of the wishlist — so the confirmed one-contact reveal would
    // instead spend on several leads.
    const enrich = compositeWriteTools.find((t) => t.name === "leadbay_enrich_titles")!;
    expect(Object.keys(enrich.inputSchema.properties ?? {})).toContain("leadIds");
    expect(Object.keys(enrich.inputSchema.properties ?? {})).not.toContain("leadId");

    // Neither surface may DIRECT the agent to pass the singular key — the
    // original defect read "call leadbay_enrich_titles AGAIN with that leadId".
    // (The word itself may still appear, in the clause forbidding it.)
    const directive = /\bwith\s+(that|the|a)\s+`?leadId`?\b(?!s)/i;
    expect(BODY).not.toMatch(directive);
    expect(gate4.spend ?? "").not.toMatch(directive);

    // And both must positively say the array form, at the PAID step.
    expect(BODY).toMatch(/leadIds:\s*\[/);
    expect(gate4.spend ?? "").toMatch(/leadIds:\s*\[/);
    expect(gate4.args?.leadIds).toBeTruthy();
  });

  // ── P1 — the manifest must never be handed out by reference ──────────────
  it("returns a fresh manifest per call, so server `_meta` cannot stick", async () => {
    const client = {} as LeadbayClient;
    const first = (await gettingStarted.execute(client, {})) as Record<string, unknown>;
    const second = (await gettingStarted.execute(client, {})) as Record<string, unknown>;

    expect(first).not.toBe(GETTING_STARTED_MANIFEST);
    expect(first).not.toBe(second);
    expect(first).toEqual(second);

    // Simulate what server.ts does to a successful result: `target._meta = {…}`.
    first._meta = { notifications: ["seen"] };
    expect(second._meta).toBeUndefined();
    expect((GETTING_STARTED_MANIFEST as Record<string, unknown>)._meta).toBeUndefined();

    // Nested mutation must not leak either — the clone is deep.
    (first.steps as Array<{ gate_label: string }>)[0].gate_label = "MUTATED";
    expect(GETTING_STARTED_MANIFEST.steps[0].gate_label).not.toBe("MUTATED");
  });

  // ── P2 — read-only deployments must not dead-end on gate 4 ───────────────
  it("gate 4 declares the write tools it needs and how to degrade without them", () => {
    // The walkthrough ships in compositeReadTools, so it is exposed even when
    // LEADBAY_MCP_WRITE=0 filters the write composites out — including the
    // enrich_titles this gate calls.
    expect(compositeWriteTools.map((t) => t.name)).toContain("leadbay_enrich_titles");
    expect(gate4.requires_tools).toContain("leadbay_enrich_titles");
    expect(gate4.unavailable ?? "").toMatch(/read-only|LEADBAY_MCP_WRITE=0/);

    // The prompt must carry the same guard, and check BEFORE offering the gate.
    expect(BODY).toMatch(/leadbay_enrich_titles/);
    expect(BODY).toMatch(/read-only|LEADBAY_MCP_WRITE=0/);
  });

  // ── P2 — the stop line must not displace ENDING B's 1:1 offer ────────────
  it("scopes the verbatim stop line to gate hand-backs, not the endings", () => {
    // Both instructions demand the LAST line of the message, so an unscoped
    // stop line and ENDING B's required closing offer cannot both hold.
    expect(BODY).toMatch(/STOP — awaiting user decision/);
    const stopSection = BODY.slice(BODY.indexOf("Where the stop line applies"));
    expect(stopSection).toMatch(/does \*\*NOT\*\* apply to the three endings|NOT.{0,40}endings/i);
    // ENDING B says so at the point of use too.
    expect(BODY).toMatch(/[Dd]o not append the stop line here/);
  });

  // ── P2 — WORKFLOWS.md must describe the four gates that shipped ─────────
  it("the workflow contract no longer requires the removed CRM / schedule gates", () => {
    // WORKFLOWS.md is normative, so leaving criteria for gates that were cut
    // makes the documented acceptance impossible for the shipped prompt.
    expect(WORKFLOWS).not.toMatch(/reached gate 5/);
    expect(WORKFLOWS).not.toMatch(/CRM connector rather than looking for a leadbay_\* CRM tool/);
    expect(GETTING_STARTED_MANIFEST.steps).toHaveLength(4);
  });
});
