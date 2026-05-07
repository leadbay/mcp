/**
 * LIVE smoke test for leadbay_list_mappable_fields.
 *
 * Opt-in: set LEADBAY_TEST_TOKEN (admin token, e.g. milstan@leadbay.ai).
 * Asserts the response merges Leadbay's StandardCrmFieldType catalog with
 * the org's /crm/custom_fields entries.
 *
 * This is part of the import-and-qualify story (B1 in 02c-eval-framework.md).
 */

import { describe, it, expect } from "vitest";
import { LeadbayClient } from "../../src/client.js";
import { listMappableFields } from "../../src/tools/list-mappable-fields.js";

const TOKEN = process.env.LEADBAY_TEST_TOKEN;
const BASE_URL = process.env.LEADBAY_TEST_BASE_URL ?? "https://api-us.leadbay.app";
const runLive = !!TOKEN;

if (!runLive) {
  // eslint-disable-next-line no-console
  console.log("[smoke] list-mappable-fields SKIPPED: set LEADBAY_TEST_TOKEN to run");
}

describe.skipIf(!runLive)("leadbay_list_mappable_fields — live smoke", () => {
  const client = () => new LeadbayClient(BASE_URL, TOKEN, "us");

  it("returns the standard catalog merged with org custom fields", async () => {
    const out = await listMappableFields.execute(client(), {});
    expect(out.region).toBe("us");
    expect(Array.isArray(out.standard_fields)).toBe(true);
    // The static catalog includes at least the foundational fields.
    const stdNames = new Set(out.standard_fields.map((s) => s.name));
    expect(stdNames.has("LEAD_NAME")).toBe(true);
    expect(stdNames.has("LEAD_WEBSITE")).toBe(true);
    expect(stdNames.has("CONTACT_TITLE")).toBe(true);
    expect(stdNames.has("LEAD_LOCATION_CITY")).toBe(true);

    // Custom fields. The dogfood org has at least a couple seeded.
    expect(Array.isArray(out.custom_fields)).toBe(true);
    for (const f of out.custom_fields) {
      expect(typeof f.id).toBe("string");
      expect(typeof f.name).toBe("string");
      expect(typeof f.type).toBe("string");
      expect(f.mapping_value).toBe(`CUSTOM.${f.id}`);
      expect(f.description.length).toBeGreaterThan(0);
    }
    // _meta block reflects the GET we made.
    expect(out._meta.endpoint).toMatch(/custom_fields/);
    expect(typeof out._meta.latency_ms).toBe("number");
  }, 30_000);
});
