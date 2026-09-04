/**
 * LIVE smoke test for product#4045 — the MCP's mapping precondition and the
 * Leadbay API's must accept the same mappings.
 *
 * `leadbay_import_leads` accepts a mapping built from any one of LEADBAY_ID,
 * CRM_ID, SIREN, LEAD_NAME or LEAD_WEBSITE. The API used to refuse four of the
 * five with `400 missing LEAD_NAME field`, so a spreadsheet with a website
 * column and no company-name column got a bare 400. Only a live call proves the
 * two sides agree: the unit harness mocks the API, so a mocked test would
 * assert our own mock.
 *
 * Opt-in: set LEADBAY_TEST_TOKEN (admin token on a dogfood account). Creates
 * real CRM-import rows in the test tenant.
 */

import { describe, it, expect } from "vitest";
import { LeadbayClient } from "../../src/client.js";
import { importLeads } from "../../src/composite/import-leads.js";

const TOKEN = process.env.LEADBAY_TEST_TOKEN;
const BASE_URL =
  process.env.LEADBAY_TEST_BASE_URL ?? "https://api-us.leadbay.app";
const runLive = !!TOKEN;

if (!runLive) {
  // eslint-disable-next-line no-console
  console.log(
    "[smoke] import-leads-website-only SKIPPED: set LEADBAY_TEST_TOKEN to run",
  );
}

const logger = {
  info: (m: string) => process.stderr.write(`[smoke] ${m}\n`),
  warn: (m: string) => process.stderr.write(`[smoke warn] ${m}\n`),
  error: (m: string) => process.stderr.write(`[smoke error] ${m}\n`),
};

describe.skipIf(!runLive)(
  "leadbay_import_leads — a mapping the MCP accepts, the API accepts",
  () => {
    const client = () => new LeadbayClient(BASE_URL, TOKEN, "us");

    it("records mode with a LEAD_WEBSITE-only mapping commits and imports", async () => {
      const out = await importLeads.execute(
        client(),
        {
          records: [{ Site: "apple.com" }, { Site: "microsoft.com" }],
          mappings: { fields: { Site: "LEAD_WEBSITE" } },
          per_phase_budget_ms: 300_000,
          total_budget_ms: 900_000,
        },
        { logger },
      );

      // The commit is what used to 400. Reaching an importId at all proves it
      // went through; matching itself is fuzzy and not what this test guards.
      expect(out.importIds.length).toBeGreaterThanOrEqual(1);
      expect(out.leads.length + out.not_imported.length).toBeGreaterThanOrEqual(
        2,
      );
    }, 1_800_000);
  },
);
