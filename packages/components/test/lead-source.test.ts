import { describe, it, expect, beforeEach } from "vitest";
import { lb, configure } from "../src/runtime.js";

// lb.leadSource — one paginated list over ANY Leadbay source, so a general
// lead board can let the rep pick where the rows come from.
//
// `callList` and `leadList` each wrap one tool, which is right for a board
// built for one job. A base template is the other case: everything
// downstream of the list (contacts, status, outreach, qualify) is identical
// whichever source the rep picks, so only the fetch and the deep link differ.
//
// The two things that DO differ are the ones a hand-rolled switch gets wrong:
//   1. the deep link's view — a Monitor lead opened on Discover drops the rep
//      into a list that does not contain it;
//   2. sorting — campaign_call_sheet has NO order param, so sending one is
//      rejected and the whole page fails.

type Call = { tool: string; args: Record<string, any> };
let calls: Call[];

function stub(payload: unknown = { leads: [{ id: "l1" }], pagination: { total: 1 } }) {
  calls = [];
  configure({
    call: async (tool, args) => {
      calls.push({ tool, args: args as Record<string, any> });
      return payload;
    },
  });
}

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  configure({});
  delete (globalThis as any).cowork;
});

describe("each source reaches its own tool", () => {
  it("followups → pull_followups", async () => {
    stub();
    lb.leadSource({ kind: "followups", ask: "x" });
    await tick();
    expect(calls[0].tool).toBe("leadbay_pull_followups");
  });

  it("discover → pull_leads, carrying the lens when given", async () => {
    stub();
    lb.leadSource({ kind: "discover", lensId: 3819, ask: "x" });
    await tick();
    expect(calls[0].tool).toBe("leadbay_pull_leads");
    expect(calls[0].args.lensId).toBe(3819);
  });

  it("campaign → campaign_call_sheet with its id", async () => {
    stub();
    lb.leadSource({ kind: "campaign", campaignId: "cmp1", ask: "x" });
    await tick();
    expect(calls[0].tool).toBe("leadbay_campaign_call_sheet");
    expect(calls[0].args.campaign_id).toBe("cmp1");
  });

  it("a campaign with no id fetches nothing rather than erroring", async () => {
    stub();
    const list = lb.leadSource({ kind: "campaign", ask: "x" });
    await tick();
    expect(calls).toHaveLength(0);
    expect(list.items).toEqual([]);
  });
});

describe("the source is read at load time, so a picker re-sources", () => {
  it("switches tool when the bound field changes", async () => {
    stub();
    const kind = lb.field({ value: "followups" });
    const list = lb.leadSource({ kind, ask: "x" });
    await tick();
    expect(calls[0].tool).toBe("leadbay_pull_followups");

    kind.setValue("discover");
    await list.loadPage(0);
    expect(calls[calls.length - 1].tool).toBe("leadbay_pull_leads");
  });
});

describe("sorting respects what each tool accepts", () => {
  it("sends order to followups and discover", async () => {
    stub();
    lb.leadSource({ kind: "discover", order: "SCORE:DESC", ask: "x" });
    await tick();
    expect(calls[0].args.order).toBe("SCORE:DESC");
  });

  it("DROPS order for a campaign — the tool has no such param", async () => {
    // Sending it is rejected, which would fail the whole board on a source
    // the rep merely selected.
    stub();
    lb.leadSource({ kind: "campaign", campaignId: "c1", order: "SCORE:DESC", ask: "x" });
    await tick();
    expect(calls[0].args).not.toHaveProperty("order");
  });
});

describe("the deep link points at the list the lead actually lives in", () => {
  it("a followups row opens Monitor", () => {
    const list = lb.leadSource({ kind: "followups", ask: "x" });
    expect(list.leadUrl({ id: "abc", in_monitor: true })).toBe(
      "https://leadbay.app/app/monitor?lead=abc",
    );
  });

  it("a discover row opens Discover", () => {
    // pull_leads omits in_monitor entirely; its rows are Discover by
    // definition, so the source decides.
    const list = lb.leadSource({ kind: "discover", ask: "x" });
    expect(list.leadUrl({ id: "abc" })).toBe("https://leadbay.app/app/discover?lead=abc");
  });

  it("a campaign row carries BOTH params", () => {
    // Omitting campaign= opens an empty campaign view.
    const list = lb.leadSource({ kind: "campaign", campaignId: "cmp1", ask: "x" });
    expect(list.leadUrl({ id: "abc" })).toBe(
      "https://leadbay.app/app/campaign?campaign=cmp1&lead=abc",
    );
  });

  it("escapes ids rather than pasting them into a URL raw", () => {
    const list = lb.leadSource({ kind: "discover", ask: "x" });
    expect(list.leadUrl({ id: "a b&c" })).toContain("lead=a%20b%26c");
  });
});

describe("a relance row carries every action the board offers", () => {
  it("exposes taste and qualify alongside status and outreach", () => {
    const row = lb.relanceRow({ leadId: "l1", ask: "x", lead: { ai_agent_lead_score: 27 } });
    expect(row.like).toBeDefined();
    expect(row.dislike).toBeDefined();
    expect(row.qualify).toBeDefined();
    // Scored lead → the button says Requalify, not Qualify.
    expect((row.qualify as any).label).toBe("Requalify");
  });

  it("an unscored lead is offered Qualify, never a re-run that never ran", () => {
    const row = lb.relanceRow({ leadId: "l1", ask: "x", lead: { id: "l1" } });
    expect((row.qualify as any).label).toBe("Qualify");
  });
});
