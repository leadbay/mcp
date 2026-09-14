/**
 * Audit: a cross-route named in the routing header points at a tool that exists.
 *
 * Hosts load roughly the first 600 characters of a tool description — that is
 * the constraint routing-block.test.ts exists to enforce. So a name that
 * appears there is a name the host will route on, and it has to resolve.
 *
 * The original failure this file caught: `leadbay_pull_leads` named
 * `leadbay_find_new_leads` at char ~300 while the availability caveat sat at
 * char ~16,100. A truncating host saw the route and never the condition, and
 * sent net-new asks at a tool that was absent from tools/list because the
 * `LEADBAY_MCP_LEAD_DELIVERY` gate was off. The fix at the time was the
 * `gated: true` marker, which emits "(only if listed)" beside the target.
 *
 * That gate is gone: the three delivery tools are registered unconditionally
 * since the /1.6/mcp/* routes shipped in backend v3.22.0. So the condition must
 * NOT appear any more — telling a host a registered tool might be missing is
 * the same misrouting bug pointed the other way. What survives is the rule
 * underneath it, asserted here against every registered tool rather than a
 * hand-kept list: a name in the header resolves.
 *
 * The `gated` marker itself stays in promptforge for the next rollout;
 * `packages/promptforge/test/routing-block.test.ts` covers the assembler.
 */

import { describe, it, expect } from "vitest";
import {
  compositeReadTools,
  compositeWriteTools,
  granularReadTools,
  granularWriteTools,
} from "@leadbay/core";
import { listAllPrompts } from "../../src/prompts.js";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HEAD = 600;
const DELIVERY_TOOLS = [
  "leadbay_find_new_leads",
  "leadbay_qualify_leads",
  "leadbay_lead_job_status",
];

const ALL = [
  ...compositeReadTools,
  ...compositeWriteTools,
  ...granularReadTools,
  ...granularWriteTools,
];
// A header may legitimately name a PROMPT (`leadbay_import_file`) or a Claude
// SKILL (`leadbay_extend_my_lens`, which ships a SKILL.md but is not in the MCP
// prompt catalogue) as the better route, so all three namespaces count.
const SKILLS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  ".claude-plugin",
  "plugins",
  "leadbay",
  "skills",
);
const REGISTERED = new Set([
  ...ALL.map((t) => t.name),
  ...listAllPrompts().map((p) => p.name),
  ...readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name),
]);

describe("audit: cross-routes in the loaded window resolve", () => {
  it("every leadbay_* named in the first 600 chars is a registered tool", () => {
    const offenders: string[] = [];
    for (const tool of ALL) {
      const desc = tool.description ?? "";
      const head = desc.slice(0, HEAD);
      for (const m of head.matchAll(/leadbay_[a-z_0-9]+/g)) {
        const name = m[0];
        if (name === tool.name) continue;
        // The window can cut a name in half (`leadbay_pull_fol`). That is a
        // truncation artefact, not a broken route — the host sees the same
        // fragment and cannot route on it either way. Only judge names that
        // end before the boundary.
        if (m.index! + name.length >= HEAD && desc.length > HEAD) continue;
        if (!REGISTERED.has(name)) {
          offenders.push(`${tool.name}: routes at ${name}, which is not registered`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("no cross-route hedges about the delivery tools any more", () => {
    // They are always in tools/list. "(only if listed)" would tell a host to
    // second-guess a route that always works.
    const offenders: string[] = [];
    for (const tool of ALL) {
      const desc = tool.description ?? "";
      for (const target of DELIVERY_TOOLS) {
        let i = desc.indexOf(target);
        while (i !== -1) {
          const around = desc.slice(i, i + target.length + 40);
          if (around.includes("only if listed") || around.includes("release-gated")) {
            offenders.push(`${tool.name}: hedges about ${target} at char ${i}`);
          }
          i = desc.indexOf(target, i + 1);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("pull_leads still cross-routes net-new asks in the loaded window", () => {
    // Guards the two cases above from passing vacuously: if the anti-trigger
    // were dropped the header would name nothing and both would be trivially
    // satisfied. pull_leads is 65% of all fleet traffic, so this is the route
    // that matters.
    const pullLeads = ALL.find((t) => t.name === "leadbay_pull_leads");
    expect(pullLeads, "leadbay_pull_leads is not registered").toBeTruthy();
    const head = (pullLeads!.description ?? "").slice(0, HEAD);
    expect(head).toContain("leadbay_find_new_leads");
    expect(head).toContain("Do NOT use for:");
  });
});
