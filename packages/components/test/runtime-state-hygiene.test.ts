import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { lb, configure, call } from "../src/runtime.js";

// Three bugs found in PR review, all of the same family: state that outlives
// the thing it belongs to, or is read at the wrong moment.
//
//   1. configure() reset every option EXCEPT the connector name, which was
//      guarded by `if (opts.server)`. Once set, it could never go back — a
//      one-way ratchet that leaked across reconfigures and across tests.
//   2. sectorLabels() memoized into ONE slot with no key, so a page whose
//      first caller took the default language and whose second asked for
//      "fr" silently got the first call's labels. No error, no cache miss.
//   3. qualify()'s checkResult re-read the live leadIds thunk AFTER the round
//      trip, so a rep changing the selection mid-flight got an error message
//      comparing against a set that was never submitted.

type Call = { tool: string; args: Record<string, any> };
let calls: Call[];

function stub(result: unknown = {}) {
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
  delete (globalThis as any).claude;
});

afterEach(() => {
  delete (globalThis as any).cowork;
  delete (globalThis as any).claude;
});

describe("configure() resets the connector name like every other option", () => {
  function claudeTransport(seen: string[]) {
    (globalThis as any).claude = {
      use: async () => ({
        callTool: async (server: string) => {
          seen.push(server);
          return { payload: {} };
        },
      }),
    };
  }

  it("a later configure({}) restores the default", async () => {
    const seen: string[] = [];
    claudeTransport(seen);

    configure({ server: "Leadbay Staging" });
    await call("leadbay_pull_followups", {});
    expect(seen[0]).toBe("Leadbay Staging");

    configure({}); // the normal reset — must not leave the override in place
    claudeTransport(seen);
    await call("leadbay_pull_followups", {});
    expect(seen[1]).toBe("Leadbay");
  });

  it("an explicit override still wins", async () => {
    const seen: string[] = [];
    claudeTransport(seen);
    configure({ server: "Other" });
    await call("leadbay_pull_followups", {});
    expect(seen[0]).toBe("Other");
  });
});

describe("the sector taxonomy is cached PER LANGUAGE", () => {
  it("a second language is fetched, not served from the first call's cache", async () => {
    calls = [];
    configure({
      call: async (tool, args) => {
        const a = args as Record<string, any>;
        calls.push({ tool, args: a });
        return a.lang === "fr"
          ? [{ id: "5134", label: "Supermarchés" }]
          : [{ id: "5134", label: "Supermarkets" }];
      },
    });

    const en = await lb.sectorLabels();
    const fr = await lb.sectorLabels({ lang: "fr" });

    expect(en["5134"]).toBe("Supermarkets");
    expect(fr["5134"]).toBe("Supermarchés"); // NOT the first call's answer
    expect(calls).toHaveLength(2);
  });

  it("the same language is still fetched once, however many rows ask", async () => {
    stub([{ id: "5134", label: "Supermarchés" }]);
    await Promise.all([
      lb.sectorLabels({ lang: "fr" }),
      lb.sectorLabels({ lang: "fr" }),
      lb.sectorLabels({ lang: "fr" }),
    ]);
    expect(calls).toHaveLength(1);
  });

  it("configure() clears every language, not just one", async () => {
    stub([{ id: "1", label: "A" }]);
    await lb.sectorLabels({ lang: "fr" });
    await lb.sectorLabels();
    expect(calls).toHaveLength(2);

    stub([{ id: "1", label: "A" }]); // reconfigure = new transport
    await lb.sectorLabels({ lang: "fr" });
    await lb.sectorLabels();
    expect(calls).toHaveLength(2); // both re-fetched through the new stub
  });
});

describe("qualify reports against what was SUBMITTED", () => {
  it("counts the launch's own selection, not the live one", async () => {
    // The documented use of `leadIds` is a live checkbox selection. If the rep
    // ticks a fourth box while the call is in flight, "1 of 4 did not start"
    // would describe a launch that only ever covered 3.
    let picked = ["a", "b", "c"];
    configure({
      call: async () => {
        picked = ["a", "b", "c", "d"]; // selection changes mid-flight
        return { failed: [{ lead_id: "a", error: "nope" }], launched_count: 2 };
      },
    });
    const act = lb.qualify({ leadIds: () => picked });
    await act.run();
    expect(act.error?.message).toMatch(/1 of 3/);
    expect(act.error?.message).not.toMatch(/of 4/);
  });

  it("still reports every lead rejected as a total failure", async () => {
    stub({ failed: [{ lead_id: "a", error: "nope" }], launched_count: 0 });
    const act = lb.qualify({ leadId: "a" });
    await act.run();
    expect(act.error?.message).toMatch(/did not start/i);
  });
});

describe("the qualify label follows a thunk", () => {
  it("re-reads `scored`, so a card repainted after a launch updates", () => {
    // The doc comment invites a thunk "when the card repaints after a
    // launch"; evaluating it once at construction made that promise a lie.
    let scored = false;
    const act = lb.qualify({ leadId: "l1", scored: () => scored });
    expect((act as any).label).toBe("Qualify");
    scored = true;
    expect((act as any).label).toBe("Requalify");
  });

  it("a plain boolean still works", () => {
    expect((lb.qualify({ leadId: "l1", scored: true }) as any).label).toBe("Requalify");
    expect((lb.qualify({ leadId: "l1" }) as any).label).toBe("Qualify");
  });
});
