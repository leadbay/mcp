/**
 * Derived idempotency key for a consented paid qualify batch.
 *
 * `request_id` is optional on this tool, so a paid submit without one could be
 * re-run by any timeout or agent retry and re-charge qualification + channel
 * purchases for the same refs. The derived key must therefore be a function of
 * the APPROVED BATCH and nothing else — in particular not of the clock, so a
 * retry that lands after midnight still dedupes.
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
import { qualifyLeads } from "../../../src/composite/qualify-leads.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.tok", "us");
const JOB_ID = "b1f0e7c4-2a56-4d80-9c33-5e6f1a2b3c4d";

const SUBMIT_202 = {
  job_id: JOB_ID,
  status_url: `/1.6/mcp/jobs/${JOB_ID}`,
  estimated_cost: { max: 238, unit: "cost_cents" },
  items_requested: 2,
  duplicate: false,
};

const SNAPSHOT = {
  job: { id: JOB_ID, state: "completed" },
  funnel: { delivered: 1 },
  items: [],
  cost: { spent: 0, unit: "cost_cents", breakdown: {} },
  next_since: null,
  explain: { region: "us", model: "m" },
};

beforeEach(() => resetHttpMock());

async function submittedRequestId(params: Record<string, unknown>) {
  resetHttpMock();
  mockHttp([
    { method: "POST", path: "/1.6/mcp/qualify", status: 202, body: SUBMIT_202 },
    {
      method: "GET",
      path: `/1.6/mcp/jobs/${JOB_ID}?limit=100`,
      status: 200,
      body: SNAPSHOT,
    },
  ]);
  await qualifyLeads.execute(newClient(), {
    confirm: true,
    wait_seconds: 0,
    ...params,
  } as any);
  const post = getHttpRequests().find((r: any) => r.method === "POST")!;
  return JSON.parse(post.body!).request_id as string;
}

const REFS = [{ website: "a.com" }, { website: "b.com" }];

describe("qualify_leads — derived idempotency key", () => {
  it("sends a derived request_id when a paid call omits one", async () => {
    const id = await submittedRequestId({ lead_refs: REFS });
    // 128-bit digest: a 32-bit one collided in practice across distinct batches.
    expect(id).toMatch(/^qualify-auto-[0-9a-f]{32}$/);
  });

  it("is stable across identical retries", async () => {
    const a = await submittedRequestId({ lead_refs: REFS });
    const b = await submittedRequestId({ lead_refs: REFS });
    expect(a).toBe(b);
  });

  it("does not depend on the clock (a retry after midnight still dedupes)", async () => {
    const a = await submittedRequestId({ lead_refs: REFS });
    // Shift the wall clock past a UTC midnight WITHOUT faking timers — fake
    // timers would stall the awaited HTTP mock. Stubbing Date.now + the Date
    // constructor is enough to catch any date component in the hash.
    const RealDate = Date;
    const shifted = new RealDate("2031-03-04T00:00:01Z").getTime();
    // @ts-expect-error — deliberate narrow stub for this assertion
    globalThis.Date = class extends RealDate {
      constructor(...args: any[]) {
        // @ts-expect-error — passthrough
        super(...(args.length ? args : [shifted]));
      }
      static now() {
        return shifted;
      }
    };
    try {
      const b = await submittedRequestId({ lead_refs: REFS });
      expect(b).toBe(a);
    } finally {
      globalThis.Date = RealDate;
    }
  });

  it("ref order does not change the key", async () => {
    const a = await submittedRequestId({ lead_refs: REFS });
    const b = await submittedRequestId({ lead_refs: [...REFS].reverse() });
    expect(a).toBe(b);
  });

  it("a raised max_cost is a NEW approved run", async () => {
    const capped = await submittedRequestId({ lead_refs: REFS, max_cost: 500 });
    const raised = await submittedRequestId({ lead_refs: REFS, max_cost: 5000 });
    expect(raised).not.toBe(capped);
  });

  it("different channels key differently", async () => {
    const email = await submittedRequestId({ lead_refs: REFS, channels: ["email"] });
    const phone = await submittedRequestId({ lead_refs: REFS, channels: ["phone"] });
    expect(email).not.toBe(phone);
  });

  it("different prior_deliveries slices key differently", async () => {
    const first = await submittedRequestId({
      prior_deliveries: { job_id: "j1", limit: 50 },
    });
    const next = await submittedRequestId({
      prior_deliveries: { job_id: "j1", limit: 50, since: "cursor-50" },
    });
    expect(next).not.toBe(first);
  });

  it("a different output language keys differently", async () => {
    const en = await submittedRequestId({ lead_refs: REFS, lang: "en" });
    const fr = await submittedRequestId({ lead_refs: REFS, lang: "fr" });
    expect(fr).not.toBe(en);
  });

  it("the same value under a different ref field keys differently", async () => {
    // {website:"acme.com"} and {name:"acme.com"} resolve differently backend
    // side, so they must not collapse onto one key.
    const byWebsite = await submittedRequestId({
      lead_refs: [{ website: "acme.com" }],
    });
    const byName = await submittedRequestId({ lead_refs: [{ name: "acme.com" }] });
    expect(byName).not.toBe(byWebsite);
  });

  it("does not collide on the pair that broke the 32-bit digest", async () => {
    // Both of these hashed to qualify-auto-76d7841e under FNV-1a, which would
    // have deduped one paid approval onto the other's job.
    const a = await submittedRequestId({
      lead_refs: [{ website: "aeqexh0jh0.com" }],
    });
    const b = await submittedRequestId({
      lead_refs: [{ website: "99rcha4ssn.com" }],
    });
    expect(a).not.toBe(b);
  });

  it("a value containing the old delimiters cannot forge another ref", async () => {
    // Under the delimiter-joined shape these serialized identically:
    //   {website:"acme~name=Paris"}  ==  {website:"acme", name:"Paris~name="}
    const forged = await submittedRequestId({
      lead_refs: [{ website: "acme~name=Paris" }],
    });
    const genuine = await submittedRequestId({
      lead_refs: [{ website: "acme", name: "Paris~name=" }],
    });
    expect(forged).not.toBe(genuine);
  });

  it("duplicate refs do not fork the key", async () => {
    // The backend collapses duplicate refs into one item, so these are the
    // same approved work. A retry that happened to dedupe would otherwise
    // present a new key and re-run the whole paid batch.
    const once = await submittedRequestId({ lead_refs: [{ website: "acme.com" }] });
    const twice = await submittedRequestId({
      lead_refs: [{ website: "acme.com" }, { website: "acme.com" }],
    });
    expect(twice).toBe(once);
  });

  it("an explicit request_id always wins", async () => {
    const id = await submittedRequestId({ lead_refs: REFS, request_id: "mine-1" });
    expect(id).toBe("mine-1");
  });
});

describe("qualify_leads — ref + set normalization", () => {
  it("a pasted URL and its normalized domain share a key", async () => {
    const pasted = await submittedRequestId({
      lead_refs: [{ website: "https://Acme.com/" }],
    });
    const clean = await submittedRequestId({ lead_refs: [{ website: "acme.com" }] });
    expect(clean).toBe(pasted);
  });

  it("stray whitespace and casing do not fork the key", async () => {
    const messy = await submittedRequestId({
      lead_refs: [{ name: "  Franklin Barbecue ", location: " Austin " }],
    });
    const tidy = await submittedRequestId({
      lead_refs: [{ name: "franklin barbecue", location: "austin" }],
    });
    expect(tidy).toBe(messy);
  });

  it("a genuinely different domain still forks the key", async () => {
    const a = await submittedRequestId({ lead_refs: [{ website: "acme.com" }] });
    const b = await submittedRequestId({ lead_refs: [{ website: "other.com" }] });
    expect(b).not.toBe(a);
  });

  it("duplicate channels do not fork the key", async () => {
    const once = await submittedRequestId({
      lead_refs: [{ website: "acme.com" }],
      channels: ["email"],
    });
    const twice = await submittedRequestId({
      lead_refs: [{ website: "acme.com" }],
      channels: ["email", "email"],
    });
    expect(twice).toBe(once);
  });
});

describe("qualify_leads — label normalization", () => {
  it("contact_titles casing and whitespace do not fork the key", async () => {
    const a = await submittedRequestId({
      lead_refs: [{ website: "acme.com" }],
      contact_titles: ["Owner"],
    });
    const b = await submittedRequestId({
      lead_refs: [{ website: "acme.com" }],
      contact_titles: ["owner "],
    });
    expect(b).toBe(a);
  });

  it("a genuinely different title still forks the key", async () => {
    const owner = await submittedRequestId({
      lead_refs: [{ website: "acme.com" }],
      contact_titles: ["Owner"],
    });
    const cto = await submittedRequestId({
      lead_refs: [{ website: "acme.com" }],
      contact_titles: ["CTO"],
    });
    expect(cto).not.toBe(owner);
  });
});

describe("qualify_leads — UUID casing", () => {
  it("an uppercase lead_id shares a key with its lowercase form", async () => {
    const upper = await submittedRequestId({
      lead_refs: [{ lead_id: "AAAA1111-2222-3333-4444-555566667777" }],
    });
    const lower = await submittedRequestId({
      lead_refs: [{ lead_id: "aaaa1111-2222-3333-4444-555566667777" }],
    });
    expect(lower).toBe(upper);
  });

  it("a non-UUID id keeps its casing (backend may be case-sensitive)", async () => {
    const a = await submittedRequestId({ lead_refs: [{ lead_id: "Ref-ABC" }] });
    const b = await submittedRequestId({ lead_refs: [{ lead_id: "ref-abc" }] });
    expect(b).not.toBe(a);
  });
});

describe("qualify_leads — prior_deliveries UUID casing", () => {
  it("job_id casing does not fork the key", async () => {
    const upper = await submittedRequestId({
      prior_deliveries: { job_id: "0A2FCBF5-18E1-4967-B5DE-0C67CD823BCC" },
    });
    const lower = await submittedRequestId({
      prior_deliveries: { job_id: "0a2fcbf5-18e1-4967-b5de-0c67cd823bcc" },
    });
    expect(lower).toBe(upper);
  });
});
