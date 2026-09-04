/**
 * Audit: a cross-route to a release-gated tool carries its condition INSIDE
 * the routing header.
 *
 * Hosts load roughly the first 600 characters of a tool description — that is
 * the constraint routing-block.test.ts exists to enforce. A caveat placed in
 * the body is therefore invisible to exactly the host that would misroute:
 * `leadbay_pull_leads` named `leadbay_find_new_leads` at char ~300 while the
 * availability caveat sat at char ~16,100, so a truncating host saw the route
 * and never the condition, and sent net-new asks at a tool absent from
 * tools/list.
 *
 * The `gated: true` marker on an anti-trigger now emits "(only if listed)"
 * beside the target, inside the block every host reads.
 */

import { describe, it, expect } from "vitest";
import * as Generated from "@leadbay/core/dist/tool-descriptions.generated.js";

const HEAD = 600;
const GATED_TARGETS = [
  "leadbay_find_new_leads",
  "leadbay_qualify_leads",
  "leadbay_lead_job_status",
];

/** Tools that are always exposed but name a gated tool in their routing. */
const CROSS_ROUTERS = ["leadbay_pull_leads", "leadbay_extend_lens"];

describe("audit: gated cross-routes are conditioned in the header", () => {
  it("every gated target named in the header carries the condition", () => {
    const offenders: string[] = [];
    for (const tool of CROSS_ROUTERS) {
      const head = (Generated as Record<string, string>)[tool].slice(0, HEAD);
      for (const target of GATED_TARGETS) {
        let i = head.indexOf(target);
        while (i !== -1) {
          // "(only if listed)" must follow the backticked name closely.
          const after = head.slice(i, i + target.length + 24);
          if (!after.includes("only if listed")) {
            offenders.push(`${tool}: ${target} at ${i} has no condition`);
          }
          i = head.indexOf(target, i + 1);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("the condition really is inside the loaded window, not the body", () => {
    // Guards the fixture: if the routing block stopped emitting the marker,
    // the test above would pass vacuously on a head containing no target.
    const head = Generated.leadbay_pull_leads.slice(0, HEAD);
    expect(head).toContain("leadbay_find_new_leads");
    expect(head).toContain("only if listed");
  });

  it("ungated cross-routes are left alone", () => {
    // The marker is opt-in; a normal route must not sprout a condition.
    const head = Generated.leadbay_pull_leads.slice(0, HEAD);
    const i = head.indexOf("leadbay_pull_followups");
    expect(i).toBeGreaterThan(-1);
    expect(head.slice(i, i + 46)).not.toContain("only if listed");
  });
});
