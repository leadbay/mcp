import { describe, it, expect, beforeEach } from "vitest";
import { lb, configure } from "../src/runtime.js";

// lb.relanceRow — one row of a follow-up table: who to reach, with channels,
// plus the two writes a rep makes after reaching them.
//
// A relance row is not a lead card. The rep is not deciding whether the lead
// fits; they are deciding who to call and recording what happened. Bundling it
// fixes four things each hand-built table got wrong independently:
//
//   1. CHANNELS ARE NOT ON THE LIST. `pull_followups` carries
//      `recommended_contact` as a NAME and nothing else. Email and phone live
//      on research_lead_by_id as contacts.reachable[]. A table that renders
//      "☎" from the list payload renders nothing.
//   2. PREFETCHING THEM IS 20 REQUESTS for a 20-row table, to fill cells the
//      rep may never read. So contacts load on the rep's gesture.
//   3. EPILOGUE AND STATUS ARE TWO SYSTEMS. "She didn't pick up" is an
//      epilogue; "we won it" is a lead status. Setting one never sets the
//      other, so the row exposes both.
//   4. A NOTE IS REQUIRED. report_outreach without one records that something
//      happened and not what — the next rep reads an empty follow-up and calls
//      blind.

type Call = { tool: string; args: Record<string, any> };
let calls: Call[];

function stub(result: unknown = {}) {
  calls = [];
  configure({
    call: async (tool, args) => {
      calls.push({ tool, args: args as Record<string, any> });
      // The sector taxonomy is a different shape from a lead profile, and a
      // row resolves it for its company-context line.
      if (tool === "leadbay_list_sectors") return [];
      return result;
    },
  });
}

/** Calls to one tool. The row makes a cached taxonomy call for its context
 *  line, so a bare `calls.length` no longer isolates the write under test. */
const only = (tool: string) => calls.filter((c) => c.tool === tool);
const research = () => only("leadbay_research_lead_by_id");
const writes = () =>
  calls.filter((c) => c.tool !== "leadbay_list_sectors" && c.tool !== "leadbay_research_lead_by_id");

// Shaped from a REAL research_lead_by_id response (lead JC2B, FR book).
// Three things that response taught, each of which the first cut got wrong:
//   - the second tier is `candidates`, not `all`
//   - a contact carries its own `recommended` flag
//   - the engagement id lives at `engagement.recommended_contact`, not top level
const PROFILE = {
  engagement: { recommended_contact: { contact_id: "org1" } },
  contacts: {
    reachable: [
      {
        id: "c1",
        first_name: "Jean",
        last_name: "DAMADE",
        job_title: "Gérant",
        email: "j.damade@sobajys.fr",
        phone: "+33 1 48 19 97 19",
        recommended: true,
        enrichment_done: true,
      },
      {
        id: "c2",
        name: "Marie Dupont",
        email: "null",
        phone: "03 22 30 40 50",
        enrichment_done: true,
      },
    ],
    candidates: [
      { id: "c3", first_name: "Alain", last_name: "Braize", job_title: "Gérant", enrichment_done: false },
      { id: "c1", first_name: "Jean", last_name: "DAMADE" }, // dup of a reachable
    ],
  },
};

beforeEach(() => {
  configure({});
  delete (globalThis as { cowork?: unknown }).cowork;
});

describe("contacts load lazily, with their channels", () => {
  it("does not fetch CONTACTS until the rep opens the row", async () => {
    stub(PROFILE);
    const row = lb.relanceRow({ leadId: "l1", ask: "relance" });
    await new Promise((r) => setTimeout(r, 0));
    // A 20-row table must fire zero research calls on load — that is the
    // whole reason contacts are lazy. (The row may resolve its company
    // context, which is one CACHED taxonomy call shared by every row.)
    expect(research()).toHaveLength(0);
    await row.contacts.load();
    expect(research()).toHaveLength(1);
    expect(research()[0].args.leadId).toBe("l1");
  });

  it("flattens email, phone and title — what the list payload cannot give", async () => {
    stub(PROFILE);
    const row = lb.relanceRow({ leadId: "l1", ask: "x" });
    await row.contacts.load();
    const got = row.contacts.data as any[];
    expect(got[0]).toMatchObject({
      name: "Jean DAMADE",
      title: "Gérant",
      email: "j.damade@sobajys.fr",
      phone: "+33 1 48 19 97 19",
      recommended: true,
    });
  });

  it("marks only the recommended contact, so a row has one default target", async () => {
    stub(PROFILE);
    const row = lb.relanceRow({ leadId: "l1", ask: "x" });
    await row.contacts.load();
    const got = row.contacts.data as any[];
    expect(got.filter((c) => c.recommended)).toHaveLength(1);
    expect(got[0].recommended).toBe(true); // its own flag
    expect(got[1].recommended).toBe(false);
  });

  it("shows CANDIDATES too — on an un-enriched book `reachable` is empty", async () => {
    // The observed failure: reading only `reachable` rendered "no contacts on
    // file" for a lead carrying nine known people. `candidates` is where they
    // live until a channel is bought.
    stub({
      contacts: {
        reachable: [],
        candidates: [
          { id: "k1", first_name: "Alain", last_name: "Braize", job_title: "Gérant" },
        ],
      },
    });
    const row = lb.relanceRow({ leadId: "l1", ask: "x" });
    await row.contacts.load();
    const got = row.contacts.data as any[];
    expect(got).toHaveLength(1);
    expect(got[0].name).toBe("Alain Braize");
    expect(got[0].enriched).toBe(false); // enrichment would buy the channel
  });

  it("does not list a contact twice when it appears in both tiers", async () => {
    stub(PROFILE);
    const row = lb.relanceRow({ leadId: "l1", ask: "x" });
    await row.contacts.load();
    const ids = (row.contacts.data as any[]).map((c) => c.contactId);
    expect(ids).toEqual([...new Set(ids)]);
    expect(ids).toEqual(["c1", "c2", "c3"]); // reachable first, then candidates
  });

  it("falls back to the engagement id when no contact carries a flag", async () => {
    // It lives at engagement.recommended_contact — NOT top level. Reading the
    // wrong path left every row without a star, silently.
    stub({
      engagement: { recommended_contact: { contact_id: "org1" } },
      contacts: { candidates: [{ id: "org1", first_name: "Thierry", last_name: "COFFY" }] },
    });
    const row = lb.relanceRow({ leadId: "l1", ask: "x" });
    await row.contacts.load();
    expect((row.contacts.data as any[])[0].recommended).toBe(true);
  });

  it("marks who already has a purchased channel", async () => {
    stub(PROFILE);
    const row = lb.relanceRow({ leadId: "l1", ask: "x" });
    await row.contacts.load();
    const got = row.contacts.data as any[];
    expect(got[0].enriched).toBe(true);
    expect(got[2].enriched).toBe(false); // the candidate
  });

  it('drops the API\'s literal "null" rather than offering it as a channel', async () => {
    stub(PROFILE);
    const row = lb.relanceRow({ leadId: "l1", ask: "x" });
    await row.contacts.load();
    const got = row.contacts.data as any[];
    expect(got[1].email).toBeUndefined(); // was the string "null"
    expect(got[1].phone).toBe("03 22 30 40 50");
  });

  it("accepts contact_id as well as id, since the payloads differ", async () => {
    stub({ contacts: { candidates: [{ contact_id: "c9", first_name: "Paul", last_name: "M" }] } });
    const row = lb.relanceRow({ leadId: "l1", ask: "x" });
    await row.contacts.load();
    expect((row.contacts.data as any[])[0]).toMatchObject({ name: "Paul M", contactId: "c9" });
  });

  it("an unnamed contact is labelled, never blank", async () => {
    stub({ contacts: { reachable: [{ email: "x@y.fr" }] } });
    const row = lb.relanceRow({ leadId: "l1", ask: "x" });
    await row.contacts.load();
    expect((row.contacts.data as any[])[0].name).toBe("Unnamed contact");
  });

  it("a lead with no contacts is an empty list, not a crash", async () => {
    stub({});
    const row = lb.relanceRow({ leadId: "l1", ask: "x" });
    await row.contacts.load();
    expect(row.contacts.data).toEqual([]);
  });
});

describe("the two write systems stay separate", () => {
  it("status writes set_lead_status and nothing else", async () => {
    stub({});
    const row = lb.relanceRow({ leadId: "l1", ask: "x", currentStatus: "WANTED" });
    row.status.setValue("WON");
    await row.saveStatus.run();
    expect(writes()).toHaveLength(1);
    expect(writes()[0].tool).toBe("leadbay_set_lead_status");
    expect(writes()[0].args.status).toBe("WON");
  });

  it("epilogue writes report_outreach and nothing else", async () => {
    stub({});
    const row = lb.relanceRow({ leadId: "l1", ask: "x" });
    row.epilogue.setValue("INTEREST_VALIDATED_OR_MEETING_PLANED");
    row.note.setValue("Meeting booked Thursday");
    await row.logOutreach.run();
    expect(writes()).toHaveLength(1);
    expect(writes()[0].tool).toBe("leadbay_report_outreach");
    expect(writes()[0].args.epilogue_status).toBe("INTEREST_VALIDATED_OR_MEETING_PLANED");
  });

  it("carries the verification report_outreach is rejected without", async () => {
    stub({});
    const row = lb.relanceRow({ leadId: "l1", ask: "relance acme" });
    row.note.setValue("Called, no answer");
    await row.logOutreach.run();
    expect(writes()[0].args.verification).toMatchObject({ source: "user_confirmed" });
    expect(writes()[0].args._triggered_by).toBe("relance acme");
  });

  it("opens the status select on the lead's CURRENT value", () => {
    const row = lb.relanceRow({ leadId: "l1", ask: "x", currentStatus: "LOST" });
    expect(row.status.value).toBe("LOST");
  });
});

describe("a note is required before an outreach can be logged", () => {
  it("blocks the write and says why", async () => {
    stub({});
    const row = lb.relanceRow({ leadId: "l1", ask: "x" });
    await row.logOutreach.run();
    expect(writes()).toHaveLength(0);
    expect(row.logOutreach.error?.message).toMatch(/note/i);
  });

  it("whitespace is not a note", async () => {
    stub({});
    const row = lb.relanceRow({ leadId: "l1", ask: "x" });
    row.note.setValue("   ");
    await row.logOutreach.run();
    expect(writes()).toHaveLength(0);
  });
});

describe("the epilogue select speaks the rep's language", () => {
  it("offers the four values with readable labels", async () => {
    stub({});
    const row = lb.relanceRow({ leadId: "l1", ask: "x" });
    await new Promise((r) => setTimeout(r, 0));
    const labels = row.epilogue.options.map((o) => o.label);
    expect(labels).toContain("Interested / meeting planned");
    expect(labels).toContain("Could not reach — still trying");
    // never the raw shouted enum
    expect(labels.join(" ")).not.toMatch(/INTEREST_VALIDATED/);
  });

  it("defaults to still chasing — the neutral outcome", () => {
    const row = lb.relanceRow({ leadId: "l1", ask: "x" });
    expect(row.epilogue.value).toBe("STILL_CHASING");
  });

  it("labels every value the kit exposes, so no option renders raw", () => {
    for (const v of lb.EPILOGUE_STATUSES) {
      expect(lb.EPILOGUE_LABELS[v]).toBeTruthy();
    }
  });
});
