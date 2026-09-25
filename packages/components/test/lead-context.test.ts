import { describe, it, expect, beforeEach } from "vitest";
import { lb, configure } from "../src/runtime.js";

// lb.sectorLabels + lb.leadContext — the company-level line every lead row
// shows: what the company does, and how to reach the COMPANY.
//
// Both halves were left to each artifact before, and both went wrong the same
// way every time:
//
//   SECTOR. `sector_id` is a raw id ("5134") and the card contract forbids
//   printing it. But the taxonomy is ~1,091 visible rows — too large to inline
//   — so boards either embedded a hand-picked subset that missed the sectors
//   the user actually holds, or dropped the line. One cached call fixes it for
//   every artifact.
//
//   CHANNELS. `phone_numbers` / `email` on a LEAD are the company switchboard,
//   not the contact's direct line. Omitting them hides a number the rep could
//   dial right now; merging them into the contact line claims a direct line
//   that does not exist.

type Call = { tool: string; args: Record<string, any> };
let calls: Call[];

const SECTORS = [
  { id: "5134", label: "Supermarchés", visible: true },
  { id: "5136", label: "Supérettes", visible: true },
];

function stub(result: unknown = SECTORS) {
  calls = [];
  configure({
    call: async (tool, args) => {
      calls.push({ tool, args: args as Record<string, any> });
      return result;
    },
  });
}

beforeEach(() => {
  configure({});
  delete (globalThis as any).cowork;
});

describe("lb.leadContext resolves what the company does", () => {
  it("prefers short_description, the card contract's first fallback", () => {
    const c = lb.leadContext(
      { short_description: "small supermarket, single-store", sector_id: "5134" },
      { "5134": "Supermarchés" },
    );
    expect(c.summary).toBe("small supermarket, single-store");
    expect(c.sector).toBe("Supermarchés"); // still exposed separately
  });

  it("falls back to description, then to the sector label", () => {
    expect(lb.leadContext({ description: "Grand fournisseur agricole" }, {}).summary).toBe(
      "Grand fournisseur agricole",
    );
    expect(lb.leadContext({ sector_id: "5136" }, { "5136": "Supérettes" }).summary).toBe(
      "Supérettes",
    );
  });

  it("NEVER prints the raw sector id when the taxonomy lacks it", () => {
    // "5134" on a card is the failure this whole helper exists to prevent.
    const c = lb.leadContext({ sector_id: "5134" }, {});
    expect(c.sector).toBeUndefined();
    expect(c.summary).toBeUndefined();
    expect(JSON.stringify(c)).not.toContain("5134");
  });
});

describe("company channels are surfaced, and kept honest", () => {
  it("exposes the company phone and email", () => {
    const c = lb.leadContext({ phone_numbers: ["03 89 22 47 21"], email: "contact@acme.fr" }, {});
    expect(c.phone).toBe("03 89 22 47 21");
    expect(c.email).toBe("contact@acme.fr");
  });

  it('drops the API\'s literal "null" rather than offering it as a number', () => {
    const c = lb.leadContext({ phone_numbers: ["null"], email: "null" }, {});
    expect(c.phone).toBeUndefined();
    expect(c.email).toBeUndefined();
  });

  it("takes the first REAL number when the list is padded with nulls", () => {
    const c = lb.leadContext({ phone_numbers: ["null", "+33 1 48 19 97 19"] }, {});
    expect(c.phone).toBe("+33 1 48 19 97 19");
  });

  it("survives a malformed lead rather than throwing mid-render", () => {
    expect(() => lb.leadContext(null, {})).not.toThrow();
    expect(() => lb.leadContext({ phone_numbers: "not-an-array" }, {})).not.toThrow();
    expect(lb.leadContext(undefined, {})).toEqual({
      summary: undefined,
      sector: undefined,
      phone: undefined,
      email: undefined,
    });
  });
});

describe("lb.sectorLabels caches the taxonomy", () => {
  it("maps id → label from the flat array the tool returns", async () => {
    stub();
    const labels = await lb.sectorLabels();
    expect(labels["5134"]).toBe("Supermarchés");
    expect(calls[0].tool).toBe("leadbay_list_sectors");
  });

  it("fetches ONCE however many rows ask — 15 rows must not be 15 calls", async () => {
    stub();
    await Promise.all([lb.sectorLabels(), lb.sectorLabels(), lb.sectorLabels()]);
    expect(calls).toHaveLength(1);
  });

  it("degrades to an empty map instead of taking the board down", async () => {
    configure({
      call: async () => {
        throw new Error("sectors unavailable");
      },
    });
    // A missing sector label costs one line of a row; it must never reject.
    await expect(lb.sectorLabels()).resolves.toEqual({});
  });
});

describe("a relance row carries its own context", () => {
  it("resolves sector and channels without the artifact wiring it", async () => {
    stub();
    const row = lb.relanceRow({
      leadId: "l1",
      ask: "x",
      lead: { sector_id: "5134", phone_numbers: ["03 89 22 47 21"] },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(row.context.data).toMatchObject({
      sector: "Supermarchés",
      summary: "Supermarchés",
      phone: "03 89 22 47 21",
    });
  });
});
