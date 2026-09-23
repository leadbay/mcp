import { describe, it, expect, beforeEach } from "vitest";
import { lb, configure, call, resetTelemetry } from "../src/runtime.js";

// Runtime telemetry (product#4081). The artifact runs in a chat-hosted page
// whose only channel out is window.cowork.callMcpTool, so every failure signal
// travels as a `leadbay_report_artifact_error` tool call. These lock:
//   - each of the six failure points actually emits
//   - the kind/surface classification (which decides Sentry vs PostHog server-side)
//   - that NO message text ever rides along (product#3943)
//   - that telemetry never re-enters itself, never throws, and stays bounded
//
// The bridge is installed as window.cowork (not lb.configure) because `report`
// deliberately uses the RAW host bridge, bypassing configure/normalize/timeout.

type Sent = { tool: string; args: Record<string, unknown> };

function installBridge(handler?: (tool: string, args: Record<string, unknown>) => unknown) {
  const sent: Sent[] = [];
  (globalThis as any).cowork = {
    callMcpTool: async (tool: string, args: Record<string, unknown>) => {
      sent.push({ tool, args });
      if (handler) return handler(tool, args);
      return { structuredContent: { ok: true } };
    },
  };
  return sent;
}

const events = (sent: Sent[]) =>
  sent.filter((s) => s.tool === "leadbay_report_artifact_error").map((s) => s.args);

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  configure({});
  delete (globalThis as { cowork?: unknown }).cowork;
  resetTelemetry();
});

describe("exception kinds → reported with the code that routes them to Sentry", () => {
  it("call_timeout when the host never settles", async () => {
    const sent = installBridge(() => new Promise(() => {}));
    configure({ timeoutMs: 20 });
    await expect(call("leadbay_pull_leads", {})).rejects.toMatchObject({ code: "timeout" });
    await tick();
    expect(events(sent)).toContainEqual(
      expect.objectContaining({
        kind: "call_timeout",
        tool: "leadbay_pull_leads",
        code: "timeout",
      }),
    );
  });

  it("call_failed when the host rejects", async () => {
    const sent = installBridge(() => {
      throw new Error("boom");
    });
    await expect(call("leadbay_pull_leads", {})).rejects.toThrow();
    await tick();
    expect(events(sent)).toContainEqual(
      expect.objectContaining({ kind: "call_failed", tool: "leadbay_pull_leads" }),
    );
  });

  it("call_failed on an isError envelope", async () => {
    const sent = installBridge(() => ({ isError: true, content: [{ text: "nope" }] }));
    await expect(call("leadbay_like_lead", {})).rejects.toThrow();
    await tick();
    expect(events(sent)).toContainEqual(
      expect.objectContaining({ kind: "call_failed", tool: "leadbay_like_lead" }),
    );
  });

  it("parse_failed — the SILENT one: unparseable text still returns, but is reported", async () => {
    const sent = installBridge(() => ({ content: [{ text: "<html>not json</html>" }] }));
    // Lenient behavior preserved: the caller still gets the raw string.
    expect(await call("leadbay_pull_leads", {})).toBe("<html>not json</html>");
    await tick();
    expect(events(sent)).toContainEqual(
      expect.objectContaining({ kind: "parse_failed", tool: "leadbay_pull_leads" }),
    );
  });

  it("bridge_unavailable cannot phone home — no bridge is the whole failure", async () => {
    // No window.cowork at all. The event has nowhere to go; the important
    // property is that this degrades silently instead of throwing.
    await expect(call("leadbay_pull_leads", {})).rejects.toMatchObject({
      code: "unavailable",
    });
  });
});

describe("outcome kinds → reported although nothing threw", () => {
  it("options_empty when a picker loads successfully with zero options", async () => {
    const sent = installBridge(() => ({ structuredContent: [] }));
    const f = lb.field({ load: () => call("leadbay_list_campaigns", {}) });
    await tick();
    await tick();
    expect(f.error).toBeNull(); // nothing failed — that is the point
    expect(f.options).toEqual([]);
    expect(events(sent)).toContainEqual(
      expect.objectContaining({
        kind: "options_empty",
        surface: "field",
        tool: "leadbay_list_campaigns",
      }),
    );
  });

  it("no options_empty when the picker actually populated", async () => {
    const sent = installBridge(() => ({ structuredContent: [{ value: "a", label: "A" }] }));
    lb.field({ load: () => call("leadbay_list_campaigns", {}) });
    await tick();
    await tick();
    expect(events(sent).filter((e) => e.kind === "options_empty")).toHaveLength(0);
  });

  it("action_blocked when validation stops a run before any call", async () => {
    const sent = installBridge();
    const f = lb.field({ value: "", validate: (v) => (v ? null : "required") });
    const a = lb.action({ tool: "leadbay_add_note", fields: [f] });
    await a.run();
    await tick();
    // The blocked click makes NO tool call — without this event it is invisible.
    expect(sent.filter((s) => s.tool === "leadbay_add_note")).toHaveLength(0);
    expect(events(sent)).toContainEqual(
      expect.objectContaining({
        kind: "action_blocked",
        surface: "action",
        tool: "leadbay_add_note",
      }),
    );
  });

  it("result_rejected on a resolved call carrying an error envelope, with its code", async () => {
    const sent = installBridge((tool) =>
      tool === "leadbay_add_note"
        ? { structuredContent: { error: true, code: "QUOTA_EXCEEDED", message: "no credits" } }
        : { structuredContent: { ok: true } },
    );
    const a = lb.action({ tool: "leadbay_add_note", args: {} });
    await a.run();
    await tick();
    expect(events(sent)).toContainEqual(
      expect.objectContaining({
        kind: "result_rejected",
        surface: "action",
        tool: "leadbay_add_note",
        code: "QUOTA_EXCEEDED",
      }),
    );
  });

  it("result_rejected when checkResult flags a partial write", async () => {
    const sent = installBridge(() => ({ structuredContent: { failed: ["a"] } }));
    const a = lb.action({
      tool: "leadbay_set_lead_status",
      args: {},
      checkResult: (r: any) => (r?.failed?.length ? "partial" : null),
    });
    await a.run();
    await tick();
    expect(events(sent)).toContainEqual(
      expect.objectContaining({ kind: "result_rejected", tool: "leadbay_set_lead_status" }),
    );
  });
});

describe("surface attribution", () => {
  it("a failing resource poll reports surface=resource", async () => {
    const sent = installBridge(() => {
      throw new Error("down");
    });
    lb.resource({ load: () => call("leadbay_bulk_enrich_status", {}) });
    await tick();
    await tick();
    expect(events(sent)).toContainEqual(
      expect.objectContaining({ kind: "call_failed", surface: "resource" }),
    );
  });

  it("a failing list page reports surface=list", async () => {
    const sent = installBridge(() => {
      throw new Error("down");
    });
    lb.list({ load: () => call("leadbay_pull_leads", {}) as any });
    await tick();
    await tick();
    expect(events(sent)).toContainEqual(
      expect.objectContaining({ kind: "call_failed", surface: "list" }),
    );
  });
});

describe("privacy, safety and bounds", () => {
  it("never sends a message — only bounded codes (product#3943)", async () => {
    const sent = installBridge(() => {
      throw new Error("Contact alice@example.com about invoice 12345");
    });
    await expect(call("leadbay_pull_leads", {})).rejects.toThrow();
    await tick();
    for (const ev of events(sent)) {
      expect(JSON.stringify(ev)).not.toContain("alice@example.com");
      expect(ev).not.toHaveProperty("message");
    }
  });

  it("never reports on the telemetry tool itself — no feedback loop", async () => {
    const sent = installBridge((tool) => {
      if (tool === "leadbay_report_artifact_error") throw new Error("sink down");
      throw new Error("boom");
    });
    await expect(call("leadbay_pull_leads", {})).rejects.toThrow();
    await tick();
    await tick();
    // One report for the real failure; the failing report does NOT report itself.
    expect(events(sent)).toHaveLength(1);
  });

  it("a failing telemetry sink never surfaces to the user", async () => {
    installBridge((tool) => {
      if (tool === "leadbay_report_artifact_error") return Promise.reject(new Error("sink down"));
      return { structuredContent: [] };
    });
    const f = lb.field({ load: () => call("leadbay_list_campaigns", {}) });
    await tick();
    await tick();
    // options_empty fired and its delivery rejected — the field stays clean.
    expect(f.error).toBeNull();
  });

  it("dedupes identical failures — a poll failing every tick emits once", async () => {
    const sent = installBridge(() => {
      throw new Error("down");
    });
    for (let i = 0; i < 5; i++) {
      await expect(call("leadbay_pull_leads", {})).rejects.toThrow();
    }
    await tick();
    expect(events(sent)).toHaveLength(1);
  });

  it("distinct failures are each reported", async () => {
    const sent = installBridge((tool) => {
      throw new Error(`down ${tool}`);
    });
    await expect(call("leadbay_pull_leads", {})).rejects.toThrow();
    await expect(call("leadbay_list_campaigns", {})).rejects.toThrow();
    await tick();
    expect(events(sent)).toHaveLength(2);
  });

  it("setTelemetry(false) opts the page out entirely", async () => {
    const sent = installBridge(() => {
      throw new Error("down");
    });
    lb.setTelemetry(false);
    await expect(call("leadbay_pull_leads", {})).rejects.toThrow();
    await tick();
    expect(events(sent)).toHaveLength(0);
  });

  it("stamps the kit version so a regression pins to a release", async () => {
    const sent = installBridge(() => {
      throw new Error("down");
    });
    await expect(call("leadbay_pull_leads", {})).rejects.toThrow();
    await tick();
    expect(events(sent)[0]).toMatchObject({ kit_version: lb.VERSION });
  });
});
