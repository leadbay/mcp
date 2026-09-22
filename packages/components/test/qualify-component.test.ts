import { describe, it, expect, beforeEach } from "vitest";
import { lb, configure } from "../src/runtime.js";

// lb.qualify — the Qualify/Requalify button, mandatory on every lead card.
//
// Before this component the guide told agents to hand-roll the action with
// lb.action({tool: "leadbay_bulk_qualify_leads", ...}). Three things that gets
// wrong, each of which produces a green button over work that never happened:
//
//   1. `leadIds` is camelCase. `lead_ids` is dropped by the schema, and with
//      no ids the tool falls back to the LENS's unqualified wishlist — the
//      button "works" while qualifying leads the rep never selected.
//   2. The launch fans out per lead and resolves 200 with a non-empty
//      `failed[]`, exactly as set_lead_status does. Its entries carry `error`,
//      NOT `message` — reading the wrong key prints "undefined".
//   3. `quota_exceeded` means a 429 mid-fanout: already-launched leads keep
//      going, further launches stopped. A partial launch is not a success.

type Call = { tool: string; args: Record<string, unknown> };

const tick = () => new Promise((r) => setTimeout(r, 0));

let calls: Call[];
function stub(result: unknown = { status: "running", lead_ids: ["l1"], launched_count: 1 }) {
  calls = [];
  configure({
    call: async (tool, args) => {
      calls.push({ tool, args: args as Record<string, unknown> });
      return result;
    },
  });
}

beforeEach(() => {
  configure({});
  delete (globalThis as { cowork?: unknown }).cowork;
});

describe("lb.qualifyLabel picks the word from the lead's own data", () => {
  it("a lead with an AI score has a verdict to replace — Requalify", () => {
    expect(lb.qualifyLabel({ ai_agent_lead_score: 27 })).toBe("Requalify");
  });

  it("a lead with answered qualification questions — Requalify", () => {
    expect(lb.qualifyLabel({ qualification_summary: { answered: 3, total: 3 } })).toBe(
      "Requalify",
    );
  });

  it("an unscored lead has never been run — Qualify", () => {
    // "Requalify" here implies a previous run that never happened, and the rep
    // reads the empty tag row as a failure of the button they just pressed.
    expect(lb.qualifyLabel({ id: "l1", name: "Acme" })).toBe("Qualify");
    expect(lb.qualifyLabel({ qualification_summary: { answered: 0, total: 3 } })).toBe("Qualify");
    expect(lb.qualifyLabel({ ai_agent_lead_score: 0 })).toBe("Qualify");
  });

  it("survives a missing or malformed lead rather than throwing on a card render", () => {
    expect(lb.qualifyLabel(null)).toBe("Qualify");
    expect(lb.qualifyLabel(undefined)).toBe("Qualify");
    expect(lb.qualifyLabel({ ai_agent_lead_score: "27" })).toBe("Qualify");
  });
});

describe("lb.qualify sends the arg shape the tool actually accepts", () => {
  it("uses camelCase leadIds — lead_ids is silently dropped by the schema", async () => {
    stub();
    await lb.qualify({ leadId: "l1", ask: "requalify acme" }).run();
    expect(calls).toHaveLength(1);
    expect(calls[0].tool).toBe("leadbay_bulk_qualify_leads");
    expect(calls[0].args.leadIds).toEqual(["l1"]);
    expect(calls[0].args).not.toHaveProperty("lead_ids");
  });

  it("returns on QUEUE, never holding through the poll", async () => {
    stub();
    await lb.qualify({ leadId: "l1" }).run();
    expect(calls[0].args.wait_for_completion).toBe(false);
  });

  it("carries _triggered_by when an ask is given, and omits it when not", async () => {
    stub();
    await lb.qualify({ leadId: "l1", ask: "re-run acme" }).run();
    expect(calls[0].args._triggered_by).toBe("re-run acme");
    stub();
    await lb.qualify({ leadId: "l1" }).run();
    expect(calls[0].args).not.toHaveProperty("_triggered_by");
  });

  it("reads a live selection at run() time, so checkboxes still being ticked work", async () => {
    stub();
    const picked: string[] = ["a"];
    const act = lb.qualify({ leadIds: () => picked, ask: "bulk" });
    picked.push("b", "c");
    await act.run();
    expect(calls[0].args.leadIds).toEqual(["a", "b", "c"]);
  });
});

describe("a partial launch is an error, not a green button", () => {
  it("every lead rejected — the write did not happen", async () => {
    stub({ failed: [{ lead_id: "l1", error: "web_fetch launch failed" }], launched_count: 0 });
    const act = lb.qualify({ leadId: "l1" });
    await act.run();
    expect(act.error?.message).toMatch(/did not start/i);
    // reads `error`, not `message` — the other key would print "undefined"
    expect(act.error?.message).toContain("web_fetch launch failed");
    expect(act.lastResult).toBeNull();
  });

  it("some rejected — says how many of how many", async () => {
    stub({ failed: [{ lead_id: "b", error: "nope" }], launched_count: 2 });
    const act = lb.qualify({ leadIds: ["a", "b", "c"] });
    await act.run();
    expect(act.error?.message).toMatch(/1 of 3/);
  });

  it("quota hit mid-fanout — a partial launch is surfaced, not celebrated", async () => {
    stub({ quota_exceeded: true, launched_count: 2, failed: [] });
    const act = lb.qualify({ leadIds: ["a", "b", "c"] });
    await act.run();
    expect(act.error?.message).toMatch(/quota/i);
    expect(act.error?.message).toMatch(/2 of 3/);
  });

  it("a clean launch succeeds", async () => {
    stub({ status: "running", lead_ids: ["l1"], launched_count: 1, failed: [] });
    const act = lb.qualify({ leadId: "l1" });
    await act.run();
    expect(act.error).toBeNull();
    expect(act.lastResult).toMatchObject({ status: "running" });
  });
});

describe("lb.qualifyStatus watches a launch to its verdict", () => {
  it("carries the launch's handles to leadbay_qualify_status", async () => {
    stub({ still_running: [] });
    lb.qualifyStatus({ notification_id: "n1", lead_ids: ["l1"], lens_id: 3819 }, "ask");
    await tick();
    expect(calls[0].tool).toBe("leadbay_qualify_status");
    expect(calls[0].args).toMatchObject({
      notification_id: "n1",
      lead_ids: ["l1"],
      lens_id: 3819,
      _triggered_by: "ask",
    });
  });

  it("is done once nothing is still running", async () => {
    stub({ still_running: [] });
    const job = lb.qualifyStatus({ notification_id: "n1" });
    await tick();
    expect(job.done).toBe(true);
  });

  it("keeps polling while leads are still running", async () => {
    stub({ still_running: [{ lead_id: "l1" }] });
    const job = lb.qualifyStatus({ notification_id: "n1" }, undefined, 5);
    await tick();
    expect(job.done).toBe(false);
    job.stop();
  });
});

describe("the button's own label", () => {
  it("rides on the action, so a card does not re-derive it", () => {
    expect((lb.qualify({ leadId: "l1", scored: true }) as any).label).toBe("Requalify");
    expect((lb.qualify({ leadId: "l1", scored: false }) as any).label).toBe("Qualify");
    expect((lb.qualify({ leadId: "l1" }) as any).label).toBe("Qualify");
  });
});
