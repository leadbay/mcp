/**
 * The no-spend kill switch, tested as behaviour rather than as source text.
 *
 * The other guard file greps live-mcp-server.ts for the switch's presence.
 * That is not enough here: the first version WAS present, and still let money
 * through — it matched only `/leads/selection/enrichment/launch`, so
 * `leadbay_prepare_outreach({enrich:true})` reached `leadbay_enrich_contacts`
 * and its per-lead reveal endpoints went straight to the real API.
 *
 * So this file extracts the actual patterns and runs the real paths through
 * them. A future endpoint rename that reopens the hole fails here.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Pull the PAID_PATHS regex literals out of the server and rebuild them. */
function paidPatterns(): RegExp[] {
  const src = readFileSync(
    resolve(__dirname, "../eval/helpers/live-mcp-server.ts"),
    "utf8",
  );
  const block = src.match(/const PAID_PATHS = \[([\s\S]*?)\];/);
  expect(block, "live-mcp-server.ts must declare PAID_PATHS").toBeTruthy();
  const literals = [...block![1].matchAll(/\/((?:[^/\\\n]|\\.)+)\//g)].map((m) => m[1]);
  expect(literals.length, "no regex literals found in PAID_PATHS").toBeGreaterThan(0);
  return literals.map((l) => new RegExp(l));
}

const blocks = (path: string): boolean => paidPatterns().some((re) => re.test(path));

describe("audit: eval no-spend kill switch covers every paid route", () => {
  // Real request paths, as the tools build them. LeadbayClient prepends /1.6.
  it.each([
    ["bulk reveal (enrich_titles)", "/1.6/leads/selection/enrichment/launch"],
    [
      "per-contact reveal (enrich_contacts, paid path)",
      "/1.6/leads/33d70225/enrich/contacts/c-1/enrich?email=true&phone=false",
    ],
    [
      "per-contact reveal (enrich_contacts, org fallback)",
      "/1.6/leads/33d70225/contacts/c-1/enrich?email=true&phone=false",
    ],
  ])("blocks %s", (_label, path) => {
    expect(blocks(path), `${path} would have reached the real API and charged`).toBe(true);
  });

  // The tour depends on these and they cost nothing — blocking them would make
  // every getting-started eval fail for the wrong reason.
  it.each([
    ["free title discovery", "/1.6/leads/selection/enrichment/job_titles"],
    ["free preview", "/1.6/leads/selection/enrichment/preview"],
    ["contact listing", "/1.6/leads/33d70225/contacts"],
    ["bulk status polling", "/1.6/leads/selection/enrichment/status"],
    ["lead read", "/1.6/leads/33d70225"],
  ])("still allows %s", (_label, path) => {
    expect(blocks(path), `${path} is free and the tour needs it`).toBe(false);
  });
});
