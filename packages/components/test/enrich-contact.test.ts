import { describe, it, expect, beforeEach } from "vitest";
import { lb, configure } from "../src/runtime.js";

// lb.enrichContact — the "reveal this contact" action a relance row offers on
// a contact with no channel.
//
// It SPENDS QUOTA, which is what shapes the component:
//   - a confirm by default, naming the spend, because a rep clicking down a
//     table should know what they are buying before the call goes out;
//   - email/phone as explicit choices, since "both" is the expensive default
//     and a rep who needs only a phone should be able to say so;
//   - the both-false case caught BEFORE the confirm, so nobody approves a
//     spend the tool would reject anyway.
//
// And the result quirk that makes naive UI wrong: for a `source:"paid"`
// candidate the channel lands on a NEW `source:"org"` contact with a
// DIFFERENT id. Patching the clicked row in place shows nothing; the contact
// set has to be re-read.

type Call = { tool: string; args: Record<string, any> };
let calls: Call[];
let confirms: string[];

function stub(result: unknown = { ok: true }) {
  calls = [];
  confirms = [];
  (globalThis as any).confirm = (m: string) => {
    confirms.push(m);
    return true;
  };
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
  delete (globalThis as any).confirm;
});

describe("the channel choice reaches the tool", () => {
  it("buys both by default, matching the tool's own defaults", async () => {
    stub();
    await lb.enrichContact({ leadId: "l1", contactId: "c1", ask: "relance" }).run();
    expect(calls[0].tool).toBe("leadbay_enrich_contacts");
    expect(calls[0].args).toMatchObject({
      leadId: "l1",
      contactId: "c1",
      email: true,
      phone: true,
    });
  });

  it("passes _triggered_by, which the MCP-exposed schema accepts", async () => {
    // The tool's raw inputSchema in core does NOT list _triggered_by and is
    // additionalProperties:false, which reads like it would reject the call.
    // The schema the MCP server actually exposes carries it as optional
    // metadata. Verified with a live call (triggered:true), so this pins the
    // exposed contract rather than the source file.
    stub();
    await lb.enrichContact({ leadId: "l1", contactId: "c1", ask: "relance" }).run();
    expect(calls[0].args._triggered_by).toBe("relance");
  });

  it("treats the real async-launch response as success", async () => {
    // Shape from a live call. There is no `ok` or `success` field — the tool
    // answers `triggered:true` plus a hint, and the reveal lands minutes
    // later, so anything looking for a completed enrichment here is wrong.
    stub({
      triggered: true,
      contact_id: "c1",
      email_requested: true,
      phone_requested: false,
      credits_remaining: "unlimited",
      hint: "Enrichment started (runs async).",
    });
    const act = lb.enrichContact({ leadId: "l1", contactId: "c1" });
    await act.run();
    expect(act.error).toBeNull();
    expect(act.lastResult).toMatchObject({ triggered: true });
  });

  it("buys phone only when that is what was asked for", async () => {
    stub();
    await lb.enrichContact({ leadId: "l1", contactId: "c1", email: false }).run();
    expect(calls[0].args).toMatchObject({ email: false, phone: true });
  });

  it("buys email only when that is what was asked for", async () => {
    stub();
    await lb.enrichContact({ leadId: "l1", contactId: "c1", phone: false }).run();
    expect(calls[0].args).toMatchObject({ email: true, phone: false });
  });

  it("reads a live choice at run() time, so checkboxes work", async () => {
    stub();
    let wantPhone = false;
    const act = lb.enrichContact({
      leadId: "l1",
      contactId: "c1",
      email: false,
      phone: () => wantPhone,
    });
    wantPhone = true;
    await act.run();
    expect(calls[0].args).toMatchObject({ email: false, phone: true });
  });
});

describe("the spend is confirmed before it happens", () => {
  it("asks before calling", async () => {
    stub();
    await lb.enrichContact({ leadId: "l1", contactId: "c1" }).run();
    expect(confirms).toHaveLength(1);
    expect(confirms[0]).toMatch(/quota/i);
  });

  it("does not call when the rep declines", async () => {
    stub();
    (globalThis as any).confirm = () => false;
    await lb.enrichContact({ leadId: "l1", contactId: "c1" }).run();
    expect(calls).toHaveLength(0);
  });

  it("takes a caller's own wording", async () => {
    stub();
    await lb.enrichContact({ leadId: "l1", contactId: "c1", confirm: "Buy Jean's phone?" }).run();
    expect(confirms[0]).toBe("Buy Jean's phone?");
  });

  it('can be suppressed with "" when the surrounding UI already asked', async () => {
    stub();
    await lb.enrichContact({ leadId: "l1", contactId: "c1", confirm: "" }).run();
    expect(confirms).toHaveLength(0);
    expect(calls).toHaveLength(1);
  });
});

describe("neither channel selected is caught before the spend", () => {
  it("blocks the call with a readable message", async () => {
    stub();
    const act = lb.enrichContact({ leadId: "l1", contactId: "c1", email: false, phone: false });
    await act.run();
    expect(calls).toHaveLength(0);
    expect(act.error?.message).toMatch(/email, phone, or both/i);
  });

  it("does not even ask for confirmation — nothing could be bought", async () => {
    stub();
    await lb.enrichContact({ leadId: "l1", contactId: "c1", email: false, phone: false }).run();
    expect(confirms).toHaveLength(0);
  });
});

describe("after a reveal, the contact set is re-read", () => {
  it("fires onDone, because the channel may land on a DIFFERENT contact", async () => {
    // A source:"paid" candidate gets a NEW source:"org" row with another id;
    // the clicked row only flips enrichment_done. Patching it in place would
    // show the rep nothing.
    stub();
    let reloaded = 0;
    await lb
      .enrichContact({ leadId: "l1", contactId: "c1", onDone: () => reloaded++ })
      .run();
    expect(reloaded).toBe(1);
  });

  it("does not re-read when the call failed", async () => {
    stub({ error: true, message: "quota exhausted" });
    let reloaded = 0;
    const act = lb.enrichContact({ leadId: "l1", contactId: "c1", onDone: () => reloaded++ });
    await act.run();
    expect(act.error?.message).toMatch(/quota exhausted/);
    expect(reloaded).toBe(0);
  });
});
