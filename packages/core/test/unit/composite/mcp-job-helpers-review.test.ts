/**
 * Review fixes on the shared MCP-job plumbing (Codex pass on PR #168).
 *
 * Three separate defects, all in _mcp-job-helpers.ts:
 *  - a flat 20-page stop truncated small-page drains while reporting done
 *  - an empty drain page overwrote the resumption cursor with null
 *  - the country guard exact-matched, so "the United States" / "U.S" /
 *    "les États-Unis" sailed through to silent same-named-town fencing
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  mockHttp,
  resetHttpMock,
  httpsMockFactory,
  getHttpRequests,
} from "../../harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import {
  collectJobSnapshot,
  rejectCountryLocations,
  mockedSubmitPreview,
} from "../../../src/composite/_mcp-job-helpers.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.tok", "us");
const JOB_ID = "5c2f0b7a-9e11-4d33-8a06-77b1c4e2f900";

const item = (seq: number) => ({
  ref: { input_indexes: [seq] },
  status: "delivered",
  seq,
  lead: { lead_id: `lead-${seq}` },
});

const page = (items: any[], next: string | null) => ({
  job: { id: JOB_ID, state: "completed" },
  funnel: { delivered: items.length },
  items,
  next_since: next,
  cost: { spent: 0, unit: "cost_cents", breakdown: {} },
  explain: { region: "us", model: "m" },
});

beforeEach(() => resetHttpMock());

describe("collectJobSnapshot — page bound scales with page size", () => {
  it("drains a small-page job past the old flat 20-page stop", async () => {
    // limit=5 over 300 items = 60 pages. The old flat MAX_PAGES=20 returned
    // 100 items and still reported the job complete.
    const TOTAL = 300;
    const SIZE = 5;
    const pages = [];
    for (let start = 0; start < TOTAL; start += SIZE) {
      const items = Array.from({ length: SIZE }, (_, i) => item(start + i));
      const isLast = start + SIZE >= TOTAL;
      pages.push({
        method: "GET" as const,
        path:
          `/1.6/mcp/jobs/${JOB_ID}?limit=${SIZE}` +
          (start === 0 ? "" : `&since=${encodeURIComponent(`cur-${start}`)}`),
        status: 200,
        body: page(items, isLast ? null : `cur-${start + SIZE}`),
      });
    }
    mockHttp(pages);

    const snap = await collectJobSnapshot(newClient(), JOB_ID, undefined, SIZE);
    expect(snap.items).toHaveLength(TOTAL);
  });
});

describe("collectJobSnapshot — cursor survives an empty drain page", () => {
  it("keeps the last non-empty page's cursor when the next page is empty", async () => {
    mockHttp([
      {
        method: "GET",
        path: `/1.6/mcp/jobs/${JOB_ID}?limit=2`,
        status: 200,
        body: page([item(0), item(1)], "cur-2"),
      },
      {
        // The drain page: no items, and the backend nulls the cursor.
        method: "GET",
        path: `/1.6/mcp/jobs/${JOB_ID}?limit=2&since=${encodeURIComponent("cur-2")}`,
        status: 200,
        body: page([], null),
      },
    ]);

    const snap = await collectJobSnapshot(newClient(), JOB_ID, undefined, 2);
    expect(snap.items).toHaveLength(2);
    // Without the fix this was null and the caller had to re-read from zero.
    expect(snap.next_since).toBe("cur-2");
  });
});

describe("rejectCountryLocations — alias normalization", () => {
  const rejects = [
    "United States",
    "the United States",
    "U.S",
    "U.S.",
    "U.S.A.",
    "USA",
    "America",
    "les États-Unis",
    "États-Unis",
    "etats-unis",
    "la France",
    "France",
    "République Française",
    "  us  ",
  ];

  for (const value of rejects) {
    it(`rejects ${JSON.stringify(value)}`, () => {
      expect(() => rejectCountryLocations([value])).toThrow(
        expect.objectContaining({ code: "COUNTRY_LEVEL_LOCATION" })
      );
    });
  }

  // The guard must not swallow legitimate places — Île-de-France in
  // particular must not be mistaken for France.
  const allows = [
    "Austin",
    "New York",
    "Paris",
    "Île-de-France",
    "Los Angeles",
    "Texas",
    "Kansas City",
  ];

  for (const value of allows) {
    it(`allows ${JSON.stringify(value)}`, () => {
      expect(() => rejectCountryLocations([value])).not.toThrow();
    });
  }

  it("ignores a non-array argument", () => {
    expect(() => rejectCountryLocations(undefined)).not.toThrow();
  });
});

describe("mockedSubmitPreview", () => {
  it("returns a preview when the submit carried no job_id (LEADBAY_MOCK)", () => {
    const previous = process.env.LEADBAY_MOCK;
    process.env.LEADBAY_MOCK = "1";
    try {
      const out = mockedSubmitPreview(
        { mocked: true, would_call: { method: "POST", path: "/1.6/mcp/search" } },
        "leadbay_find_new_leads",
        "us"
      );
      expect(out).not.toBeNull();
      expect(out!.submitted).toBe(false);
      expect(out!.tool).toBe("leadbay_find_new_leads");
    } finally {
      if (previous === undefined) delete process.env.LEADBAY_MOCK;
      else process.env.LEADBAY_MOCK = previous;
    }
  });

  it("returns null for a real submit so the normal poll proceeds", () => {
    expect(
      mockedSubmitPreview({ job_id: JOB_ID }, "leadbay_find_new_leads", "us")
    ).toBeNull();
  });
});

describe("rejectCountryLocations — scalar input", () => {
  // The server does not validate the schema before dispatch, so a bare string
  // reaches the tool. Treating a non-array as "nothing to check" let a scalar
  // country label through to the silent same-named-town fencing.
  it("rejects a bare string country label", () => {
    expect(() => rejectCountryLocations("United States")).toThrow(
      expect.objectContaining({ code: "COUNTRY_LEVEL_LOCATION" })
    );
    expect(() => rejectCountryLocations("la France")).toThrow(
      expect.objectContaining({ code: "COUNTRY_LEVEL_LOCATION" })
    );
  });

  it("still allows a bare string city", () => {
    expect(() => rejectCountryLocations("Austin")).not.toThrow();
    expect(() => rejectCountryLocations("Île-de-France")).not.toThrow();
  });

  it("ignores null/undefined", () => {
    expect(() => rejectCountryLocations(null)).not.toThrow();
    expect(() => rejectCountryLocations(undefined)).not.toThrow();
  });
});

describe("mockedSubmitPreview — only in mock mode", () => {
  it("throws on a real submit that carried no job_id", () => {
    const previous = process.env.LEADBAY_MOCK;
    delete process.env.LEADBAY_MOCK;
    try {
      expect(() => mockedSubmitPreview({}, "leadbay_find_new_leads", "us")).toThrow(
        expect.objectContaining({ code: "MALFORMED_SUBMIT_RESPONSE" })
      );
    } finally {
      if (previous !== undefined) process.env.LEADBAY_MOCK = previous;
    }
  });

  it("returns the preview when mock mode is on", () => {
    const previous = process.env.LEADBAY_MOCK;
    process.env.LEADBAY_MOCK = "1";
    try {
      const out = mockedSubmitPreview({ mocked: true }, "leadbay_find_new_leads", "us");
      expect(out?.submitted).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.LEADBAY_MOCK;
      else process.env.LEADBAY_MOCK = previous;
    }
  });
});
