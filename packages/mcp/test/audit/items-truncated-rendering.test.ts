/**
 * Audit: a partial page set is never presented as the whole batch.
 *
 * collectJobSnapshot stops draining when the caller's wait budget runs out (and
 * at the maxPages backstop, and on abort). `items` is then a PREFIX of what the
 * job holds, while `funnel.delivered` still reports the backend's full count —
 * so an undocumented truncation renders "delivered 40" over 12 rows and reads
 * as though 28 leads simply did not exist.
 *
 * Unlike the disqualified rule, this one is SHARED by all three delivery tools.
 * Scoping it to the drain-heavy pair would leave find_new_leads silently
 * misreporting on the day its item count crosses a page — the precise failure
 * being fixed here — and that divergence risk is worth more than the chars.
 */

import { describe, it, expect } from "vitest";
import * as Generated from "@leadbay/core/dist/tool-descriptions.generated.js";

const G = Generated as unknown as Record<string, string>;
const DELIVERY_TOOLS = [
  "leadbay_find_new_leads",
  "leadbay_qualify_leads",
  "leadbay_lead_job_status",
];

describe("audit: items_truncated rendering", () => {
  it("every delivery tool carries the rule", () => {
    for (const tool of DELIVERY_TOOLS) {
      expect(G[tool], `${tool} missing the truncation rule`).toMatch(
        /items_truncated/
      );
    }
  });

  it("names the field the agent tests and the recovery it offers", () => {
    for (const tool of DELIVERY_TOOLS) {
      const d = G[tool];
      // The rows are a prefix...
      expect(d, `${tool} does not say the rows are partial`).toMatch(/PREFIX/);
      // ...and the cursor is how the rest is fetched.
      expect(d, `${tool} does not name the resumption path`).toMatch(
        /leadbay_lead_job_status\(job_id, since: next_since\)/
      );
    }
  });

  it("stays within the per-tool description budget", () => {
    for (const tool of DELIVERY_TOOLS) {
      expect(G[tool].length, `${tool} over budget`).toBeLessThanOrEqual(17000);
    }
  });
});
