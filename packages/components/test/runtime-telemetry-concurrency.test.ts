import { describe, it, expect, beforeEach } from "vitest";
import { lb, configure, call, resetTelemetry } from "../src/runtime.js";

// Regression: options_empty must name the tool THIS load called, not whichever
// call happened to start most recently (product#4081 review).
//
// Two pickers mounting together is an ordinary artifact layout — the triage
// board does it. With a shared `lastTool` global, read after the load's await,
// the first picker to resolve reported the second picker's tool name. The tool
// is now recorded into a per-load slot synchronously at call() entry, which is
// the same discipline runningSurface already used for `surface`.
//
// These deliberately interleave: both loads start before either settles.

type Sent = { tool: string; args: Record<string, unknown> };

function installBridge(handler: (tool: string) => Promise<unknown>) {
  const sent: Sent[] = [];
  (globalThis as any).cowork = {
    callMcpTool: async (tool: string, args: Record<string, unknown>) => {
      sent.push({ tool, args });
      return handler(tool);
    },
  };
  return sent;
}

const events = (sent: Sent[]) =>
  sent.filter((s) => s.tool === "leadbay_artifact_event").map((s) => s.args);

const settle = () => new Promise((r) => setTimeout(r, 30));

beforeEach(() => {
  configure({});
  delete (globalThis as { cowork?: unknown }).cowork;
  resetTelemetry();
});

describe("concurrent loads do not cross-attribute the tool", () => {
  it("two pickers, both empty — each names its OWN tool", async () => {
    // Campaigns resolves LAST, so under the old shared-global read it would
    // have picked up whichever tool started most recently.
    const sent = installBridge(async (tool) => {
      if (tool === "leadbay_list_campaigns") await new Promise((r) => setTimeout(r, 20));
      return { structuredContent: [] };
    });

    // Mount together — neither has settled when the second starts.
    const a = lb.field({ load: () => call("leadbay_list_campaigns", {}) });
    const b = lb.field({ load: () => call("leadbay_list_sectors", {}) });
    await settle();

    expect(a.options).toEqual([]);
    expect(b.options).toEqual([]);

    const empties = events(sent).filter((e) => e.kind === "options_empty");
    const tools = empties.map((e) => e.tool).sort();
    expect(tools).toEqual(["leadbay_list_campaigns", "leadbay_list_sectors"]);
  });

  it("the slow picker's event is not stamped with the fast picker's tool", async () => {
    // Only the SLOW one comes back empty. If attribution leaked, the event
    // would carry the fast picker's tool name.
    const sent = installBridge(async (tool) => {
      if (tool === "leadbay_list_campaigns") {
        await new Promise((r) => setTimeout(r, 20));
        return { structuredContent: [] };
      }
      return { structuredContent: [{ value: "x", label: "X" }] };
    });

    lb.field({ load: () => call("leadbay_list_campaigns", {}) });
    lb.field({ load: () => call("leadbay_list_sectors", {}) });
    await settle();

    const empties = events(sent).filter((e) => e.kind === "options_empty");
    expect(empties).toHaveLength(1);
    expect(empties[0].tool).toBe("leadbay_list_campaigns");
  });

  it("many pickers resolving out of order each keep their own tool", async () => {
    const names = ["leadbay_list_campaigns", "leadbay_list_sectors", "leadbay_list_locations"];
    // Reverse-order delays, so completion order is the opposite of start order.
    const delay: Record<string, number> = {
      leadbay_list_campaigns: 24,
      leadbay_list_sectors: 12,
      leadbay_list_locations: 0,
    };
    const sent = installBridge(async (tool) => {
      await new Promise((r) => setTimeout(r, delay[tool] ?? 0));
      return { structuredContent: [] };
    });

    for (const n of names) lb.field({ load: () => call(n, {}) });
    await settle();

    const tools = events(sent)
      .filter((e) => e.kind === "options_empty")
      .map((e) => e.tool)
      .sort();
    expect(tools).toEqual([...names].sort());
  });

  it("a concurrent failing list does not steal the empty picker's tool", async () => {
    const sent = installBridge(async (tool) => {
      if (tool === "leadbay_pull_leads") throw new Error("down");
      await new Promise((r) => setTimeout(r, 15));
      return { structuredContent: [] };
    });

    lb.field({ load: () => call("leadbay_list_campaigns", {}) });
    lb.list({ load: () => call("leadbay_pull_leads", {}) as any });
    await settle();

    const empty = events(sent).find((e) => e.kind === "options_empty");
    expect(empty?.tool).toBe("leadbay_list_campaigns");
    const failed = events(sent).find((e) => e.kind === "call_failed");
    expect(failed?.tool).toBe("leadbay_pull_leads");
    expect(failed?.surface).toBe("list");
  });

  it("a loader that calls nothing reports no tool rather than a stale one", async () => {
    const sent = installBridge(async () => ({ structuredContent: [] }));
    // Prime the machinery with a real call first.
    await call("leadbay_list_campaigns", {});
    // This loader resolves locally — it never calls a tool, so there is no
    // tool to name. Absent is correct; a stale global name would be a lie.
    lb.field({ load: async () => [] });
    await settle();

    const empty = events(sent).find((e) => e.kind === "options_empty");
    expect(empty).toBeDefined();
    expect(empty).not.toHaveProperty("tool");
  });
});
