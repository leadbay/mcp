import { describe, it, expect, beforeEach } from "vitest";
import { lb, configure } from "../src/runtime.js";

// lb.reachCoverage — how much of the book is callable, how much is one
// enrichment away, how much is neither.
//
// The rule this encodes is the card contract's, applied to the whole book:
// `contacts_count > 0` is NOT reachability. It counts known PEOPLE, not
// people you can dial — the guide records a lead showing 2,518 contacts and
// zero channels. A board that charts contacts_count tells a rep they have a
// pipeline when they have a phone book with no numbers.
//
// Three states, because the middle one is the answer to "what should I buy?":
// `contacts_only` is the only bucket where enrichment converts a dead row
// into a callable one.
//
// Unlike every other coverage dimension this is SAMPLED: reachability is not
// a FilterCriterion, so there is no cheap pagination.total for it.

const lead = (o: Record<string, unknown> = {}) => o;

beforeEach(() => {
  configure({});
  delete (globalThis as { cowork?: unknown }).cowork;
});

describe("leadReach: contacts are not channels", () => {
  it("a company phone makes a lead callable", () => {
    expect(lb.leadReach(lead({ phone_numbers: ["03 89 22 47 21"] }))).toBe("reachable");
    expect(lb.leadReach(lead({ has_phone: true }))).toBe("reachable");
  });

  it("an email makes a lead callable", () => {
    expect(lb.leadReach(lead({ email: "contact@acme.fr" }))).toBe("reachable");
  });

  it("contacts WITHOUT a channel is the enrichment bucket, not the callable one", () => {
    // The whole point of the board: 8 known people, nobody dialable.
    expect(lb.leadReach(lead({ contacts_count: 8 }))).toBe("contacts_only");
    expect(lb.leadReach(lead({ org_contacts_count: 3 }))).toBe("contacts_only");
    // …even at absurd counts — the guide's 2,518-contacts lead.
    expect(lb.leadReach(lead({ contacts_count: 2518 }))).toBe("contacts_only");
  });

  it("a LinkedIn page is not reachability — a rep cannot message a URL", () => {
    expect(
      lb.leadReach(lead({ social_urls: { linkedin: "https://linkedin.com/company/x" } })),
    ).toBe("empty");
  });

  it("neither contacts nor channels is the discovery bucket", () => {
    expect(lb.leadReach(lead({ contacts_count: 0 }))).toBe("empty");
    expect(lb.leadReach(lead())).toBe("empty");
  });

  it('the API\'s literal "null" string does not count as a channel', () => {
    // A real lead ships phone_numbers:["null"]. Counting it overstates the
    // callable book — the one error that makes this board actively harmful.
    expect(lb.leadReach(lead({ phone_numbers: ["null"] }))).toBe("empty");
    expect(lb.leadReach(lead({ email: "null" }))).toBe("empty");
    expect(lb.leadReach(lead({ phone_numbers: ["null"], contacts_count: 2 }))).toBe(
      "contacts_only",
    );
  });

  it("survives a malformed lead rather than throwing mid-sweep", () => {
    expect(lb.leadReach(null)).toBe("empty");
    expect(lb.leadReach(undefined)).toBe("empty");
    expect(lb.leadReach(lead({ phone_numbers: "not-an-array" }))).toBe("empty");
    expect(lb.leadReach(lead({ contacts_count: "8" }))).toBe("empty");
  });
});

describe("lb.reachCoverage classifies a sample against the real book", () => {
  function stub(leads: unknown[], total = 7078) {
    configure({
      call: async () => ({ leads, pagination: { total } }),
    });
  }

  it("splits the three buckets in a fixed, readable order", async () => {
    stub([
      lead({ has_phone: true }),
      lead({ phone_numbers: ["+33 1 48 19 97 19"] }),
      lead({ contacts_count: 8 }),
      lead({}),
    ]);
    const r = await lb.reachCoverage({ ask: "reachability" });
    expect(r.rows.map((x) => [x.id, x.total])).toEqual([
      ["reachable", 2],
      ["contacts_only", 1],
      ["empty", 1],
    ]);
    expect(r.rows.map((x) => x.label)).toEqual([
      "Callable now",
      "Contacts, no channel",
      "No contacts",
    ]);
  });

  it("reports the sample size and the real book, so the estimate can be labelled", async () => {
    stub([lead({ has_phone: true }), lead({})], 7078);
    const r = await lb.reachCoverage({ ask: "x" });
    expect(r.sampled).toBe(2);
    expect(r.bookTotal).toBe(7078); // ← the denominator, not the sample
  });

  it("takes the denominator from the same page — no second call", async () => {
    let n = 0;
    configure({
      call: async () => {
        n++;
        return { leads: [lead({})], pagination: { total: 7078 } };
      },
    });
    const r = await lb.reachCoverage({ ask: "x" });
    expect(n).toBe(1);
    expect(r.bookTotal).toBe(7078);
  });

  it("samples UNFILTERED, so the shape is the book's and not the Monitor tab's", async () => {
    const seen: Array<Record<string, any>> = [];
    configure({
      call: async (_t, args) => {
        seen.push(args as Record<string, any>);
        return { leads: [], pagination: { total: 0 } };
      },
    });
    await lb.reachCoverage({ ask: "x", personal: true, sample: 50 });
    expect(seen[0].filtered).toBe(false);
    expect(seen[0].count).toBe(50);
    expect(seen[0].personal).toBe(true);
  });

  it("an empty book is a real answer, not a crash", async () => {
    stub([], 0);
    const r = await lb.reachCoverage({ ask: "x" });
    expect(r.sampled).toBe(0);
    expect(r.bookTotal).toBe(0);
    expect(r.rows.every((x) => x.total === 0)).toBe(true);
  });

  it("a book with no purchased channels reads as 0% callable", async () => {
    // The observed shape of this account: CRM-imported, never enriched.
    stub(Array.from({ length: 5 }, () => lead({ has_phone: false, contacts_count: 2 })), 7078);
    const r = await lb.reachCoverage({ ask: "x" });
    expect(r.rows[0].total).toBe(0); // callable now
    expect(r.rows[1].total).toBe(5); // every one is an enrichment candidate
  });
});
