/**
 * The live eval harness must not invent a region for a custom endpoint.
 *
 * `LEADBAY_BASE_URL` points a run at staging. The region pin alongside it is
 * load-bearing — without it the client derives "custom" from an unrecognised
 * host and the single-country guard classifies every country as
 * `country_indeterminate` instead of home vs foreign (product#3951), so the run
 * exercises a different branch than the one under test.
 *
 * But pinning and GUESSING are different things. The harness used to default
 * the region to "us" and pass that explicitly, so a staging tenant nobody had
 * identified was asserted to hold United States companies only, and the eval
 * reported `_meta.region: "us"` for it. That is the harness committing the
 * exact confidently-wrong-answer failure the scenarios exist to catch — and
 * because the judge ledger carries `_meta.region`, it would have been read as
 * evidence the agent got the region right.
 *
 * Undefined is the honest value: the client still maps a known regional URL to
 * us/fr, and anything else becomes "custom" (same rule as client.ts:103-106).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { LeadbayClient } from "@leadbay/core";

const MCP_SERVER = readFileSync(
  resolve(__dirname, "../eval/helpers/live-mcp-server.ts"),
  "utf8",
);

describe("audit: the eval harness never guesses a region", () => {
  it("does not default LEADBAY_REGION to a real region", () => {
    expect(
      MCP_SERVER,
      'live-mcp-server must not fall back to "us" — an unpinned custom endpoint has no known country'
    ).not.toMatch(/LEADBAY_REGION\s*\?\?\s*["']us["']/);
  });

  it("passes the pin through only when it was actually supplied", () => {
    expect(MCP_SERVER).toMatch(/pinnedRegion/);
    // The constructor gets the possibly-undefined pin, not a coerced string.
    expect(MCP_SERVER).toMatch(/new LeadbayClient\(baseUrl, token, pinnedRegion\)/);
  });

  it("reports the region the client actually resolved", () => {
    // Reporting the requested region rather than the resolved one would put the
    // guess back, one layer further out.
    expect(MCP_SERVER).toMatch(/const region = client\.region/);
  });
});

describe("the derivation the harness now relies on", () => {
  // Pinning the client behaviour too: the audit above is a source grep, and a
  // grep cannot tell a correct derivation from a broken one.
  it("derives us/fr from the known regional URLs", () => {
    expect(new LeadbayClient("https://api-us.leadbay.app", "t").region).toBe("us");
    expect(new LeadbayClient("https://api-fr.leadbay.app", "t").region).toBe("fr");
  });

  it("derives custom from an unrecognised staging host", () => {
    expect(new LeadbayClient("https://api-staging.leadbay.app", "t").region).toBe("custom");
  });

  it("an explicit pin still wins over the URL", () => {
    expect(new LeadbayClient("https://api-staging.leadbay.app", "t", "fr").region).toBe("fr");
  });
});
