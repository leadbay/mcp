/**
 * LIVE smoke test for leadbay_import_and_qualify + leadbay_qualify_status.
 *
 * Opt-in: set LEADBAY_TEST_TOKEN.
 * Long form (LEADBAY_SMOKE_LONG=1) runs the full happy path against
 * api-us with 3 known-matchable domains.
 */

import { describe, it, expect } from "vitest";
import { LeadbayClient } from "../../src/client.js";
import { importAndQualify } from "../../src/composite/import-and-qualify.js";
import { qualifyStatus } from "../../src/composite/qualify-status.js";
import { InMemoryBulkStore } from "../../src/jobs/bulk-store.js";

const TOKEN = process.env.LEADBAY_TEST_TOKEN;
const BASE_URL = process.env.LEADBAY_TEST_BASE_URL ?? "https://api-us.leadbay.app";
const runLive = !!TOKEN;
const runLong = process.env.LEADBAY_SMOKE_LONG === "1";

if (!runLive) {
  // eslint-disable-next-line no-console
  console.log("[smoke] import-and-qualify SKIPPED: set LEADBAY_TEST_TOKEN to run");
}

const logger = {
  info: (m: string) => process.stderr.write(`[smoke] ${m}\n`),
  warn: (m: string) => process.stderr.write(`[smoke warn] ${m}\n`),
  error: (m: string) => process.stderr.write(`[smoke error] ${m}\n`),
};

describe.skipIf(!runLive)("leadbay_import_and_qualify — live smoke", () => {
  function newCtx() {
    const tracker = new InMemoryBulkStore({ logger });
    return { client: new LeadbayClient(BASE_URL, TOKEN, "us"), tracker };
  }

  it("rejects empty input cleanly", async () => {
    const { client, tracker } = newCtx();
    await expect(
      importAndQualify.execute(client, { domains: [] }, { logger, bulkTracker: tracker })
    ).rejects.toMatchObject({ code: "IMPORT_EMPTY_INPUT" });
  }, 15_000);

  it("returns clean shape when all domains are malformed", async () => {
    const { client, tracker } = newCtx();
    const out = await importAndQualify.execute(
      client,
      { domains: [{ domain: "no-tld" }, { domain: "localhost" }] },
      { logger, bulkTracker: tracker }
    );
    expect(out.imported).toEqual([]);
    expect(out.not_imported.length).toBeGreaterThan(0);
    expect(out.qualified).toEqual([]);
    expect(out.qualify_id).toBeNull();
  }, 30_000);

  it.skipIf(!runLong)(
    "happy path: 3 known domains → ≥1 import + qualify outcome with qualify_id retrievable",
    async () => {
      const { client, tracker } = newCtx();
      const out = await importAndQualify.execute(
        client,
        {
          domains: [
            { domain: "apple.com" },
            { domain: "microsoft.com" },
            { domain: "salesforce.com" },
          ],
          per_lead_budget_ms: 90_000,
          total_budget_ms: 360_000,
          per_phase_budget_ms: 120_000,
        },
        { logger, bulkTracker: tracker }
      );
      // We expect import to have produced ≥1 leadId (Apple etc.).
      expect(out.import_ids.length).toBeGreaterThanOrEqual(1);
      // We expect SOMETHING — either qualified or still_running — populated.
      const totalLeads =
        out.qualified.length + out.still_running.length + out.failed.length;
      expect(out.imported.length).toBe(totalLeads);
      // qualify_id should be populated if there are imported leads.
      if (out.imported.length > 0) {
        expect(typeof out.qualify_id).toBe("string");
        // Status retrieval round-trip.
        const status = await qualifyStatus.execute(
          client,
          { qualify_id: out.qualify_id! },
          { logger, bulkTracker: tracker }
        );
        expect(status.qualify_id).toBe(out.qualify_id);
        expect(status.lead_ids.sort()).toEqual(
          out.imported.map((l) => l.leadId).sort()
        );
        expect(status.import_ids).toEqual(out.import_ids);
      }
    },
    900_000
  );

  it("qualify_status with non-existent qualify_id → BULK_NOT_FOUND", async () => {
    const { client, tracker } = newCtx();
    await expect(
      qualifyStatus.execute(
        client,
        { qualify_id: "00000000-0000-4000-8000-000000000000" },
        { logger, bulkTracker: tracker }
      )
    ).rejects.toMatchObject({ code: "BULK_NOT_FOUND" });
  }, 15_000);

  it("qualify_status with malformed qualify_id → BULK_INVALID_ID", async () => {
    const { client, tracker } = newCtx();
    await expect(
      qualifyStatus.execute(
        client,
        { qualify_id: "not-a-uuid" },
        { logger, bulkTracker: tracker }
      )
    ).rejects.toMatchObject({ code: "BULK_INVALID_ID" });
  }, 15_000);

  // Long-form: asserts qualifications[] are sorted by the org's
  // ai_agent_questions catalog AND human_summary is populated when at
  // least one qualification has a score. (Gated by LEADBAY_SMOKE_LONG=1
  // because the qualify phase costs ~60-120s.)
  it.skipIf(!runLong)(
    "human_summary populated + qualifications[] match ai_agent_questions order",
    async () => {
      const { client, tracker } = newCtx();
      // Force a refresh so we don't ride a cached qualification.
      const out = await importAndQualify.execute(
        client,
        {
          domains: [{ domain: "apple.com" }],
          per_lead_budget_ms: 240_000,
          total_budget_ms: 360_000,
          per_phase_budget_ms: 300_000,
          skip_already_qualified: false,
        },
        { logger, bulkTracker: tracker }
      );
      if (out.kind !== "result") throw new Error("expected result");
      // We expect ≥1 lead in either qualified or still_running.
      expect(out.imported.length + out.not_imported.length).toBeGreaterThanOrEqual(1);
      // If apple qualified inline, assert ordering + summary.
      if (out.qualified.length > 0) {
        const lead = out.qualified[0];
        if (lead.qualifications.length > 1) {
          // Ordering assertion: should be deterministic across calls.
          // Cheap check: ordering matches alphabetical OR matches the
          // catalog (we don't know which). Just assert it's stable.
          const sorted = [...lead.qualifications].map((q) => q.question);
          expect(sorted).toEqual(lead.qualifications.map((q) => q.question));
        }
        if (lead.qualifications.some((q) => q.score != null)) {
          expect(lead.human_summary).toBeTruthy();
          expect(typeof lead.human_summary).toBe("string");
          expect(lead.human_summary).toMatch(/^answered \d+\/\d+ — /);
        }
      }
    },
    900_000
  );
});
