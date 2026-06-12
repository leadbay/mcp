// Deterministic regression lock for the sector-creation crash class
// (telemetry 30d ending 2026-06-12: adjust_audience 61% fail, 19 TypeError).
//
// Mirrors the MCP eval scenario
// packages/mcp/test/eval/scenarios/lens-creation/adjust-audience-dirty-taxonomy.scenario.ts
// at the deterministic unit layer. New file per the repo invariant: never
// edit existing tests.
//
// What it locks (adjust-audience.ts:35, the tokens() null-guard `if (!s)
// return []`): a {id, name: null} row in the sector taxonomy must NOT throw
// "Cannot read properties of undefined (reading 'toLowerCase')" while
// scanning. The multi-sector dirty-taxonomy request must resolve to a
// graceful ambiguous_sectors message, never a TypeError.
//
// RED proof: making tokens() call s.toLowerCase() unconditionally (dropping
// the guard) makes the no-throw assertion fail.

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
  getHttpRequests,
} from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import { adjustAudience } from "../../../src/composite/adjust-audience.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

const ME = {
  id: "u-1",
  email: "u@example.com",
  organization: { id: "org-1", name: "Acme" },
  admin: false,
  last_requested_lens: 4242,
  language: "fr",
};

// Dirty taxonomy: a null-name row (the crash row) + only weak/ambiguous
// matches for the requested sectors. The intent
// "menuisiers, pergolas, vérandas" should land on an ambiguous_sectors
// message, not a confident apply and not a throw.
// "Pergola" overlaps two distinct sectors equally → ambiguous (no confident
// single pick), so the whole call bails with ambiguous_sectors before any
// write. The null-name row sits in the middle of the scan to prove the
// taxonomy walk tolerates it.
const SECTORS = [
  { id: "1", name: "Pergola aluminium" },
  { id: "2", name: null }, // dirty row — used to crash the taxonomy scan
  { id: "3", name: "Pergola bioclimatique" },
  { id: "4", name: "Plomberie" },
];

const SECTORS_PATH = "/1.5/sectors/all?lang=fr&includeInvisible=false";

beforeEach(() => resetHttpMock());

describe("leadbay_adjust_audience — dirty-taxonomy no-crash regression (sector-creation crash class)", () => {
  it("a null-name taxonomy row does not throw a TypeError while scanning", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: ME },
      { method: "GET", path: SECTORS_PATH, status: 200, body: SECTORS },
      // No lens-write fixtures: ambiguous resolution must bail before any POST.
    ]);

    // THE LOAD-BEARING ASSERTION: this resolves instead of throwing.
    // Pre-fix (unguarded toLowerCase) it rejected with a TypeError.
    await expect(
      adjustAudience.execute(newClient(), {
        sectors: ["Pergola"],
      })
    ).resolves.toBeDefined();
  });

  it("returns a graceful ambiguous_sectors message and writes no half-built lens", async () => {
    mockHttp([
      { method: "GET", path: "/1.5/users/me", status: 200, body: ME },
      { method: "GET", path: SECTORS_PATH, status: 200, body: SECTORS },
    ]);

    const result: any = await adjustAudience.execute(newClient(), {
      sectors: ["Pergola"],
    });

    // Graceful resolution — NOT a crash, NOT an apply.
    expect(result.status).toBe("ambiguous_sectors");
    expect(Array.isArray(result.sector_ambiguities)).toBe(true);
    expect(result.sector_ambiguities.length).toBeGreaterThan(0);
    expect(typeof result.message).toBe("string");
    // The message must NAME the unresolved sector text (the WORKFLOWS /
    // scenario contract), not return a generic/empty ambiguity object.
    const entry = result.sector_ambiguities.find(
      (a: any) => a.sector_text === "Pergola"
    );
    expect(entry).toBeDefined();
    expect(entry.matches.length).toBeGreaterThanOrEqual(2);

    // No mutation happened — no POST went out at all.
    expect(getHttpRequests().some((r) => r.method === "POST")).toBe(false);
  });
});
