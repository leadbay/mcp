import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { lb, configure, call } from "../src/runtime.js";

// The kit reached the host ONLY through `window.cowork.callMcpTool`. A
// published claude.ai artifact has no window.cowork — it reaches the viewer's
// connectors through `window.claude.use("mcp")`, granted by the
// capabilities.mcp manifest declared at publish time.
//
// So every kit artifact published to claude.ai threw `unavailable` on its
// first call and rendered an empty board. The page looked built, the controls
// were wired, and no data ever arrived — the failure mode the user hit as
// "I cant reach my data inside".

type Use = (n: string) => Promise<unknown>;

function withClaude(use: Use) {
  (globalThis as any).claude = { use };
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

describe("the claude.ai mcp transport", () => {
  it("calls the connector by display name and unwraps payload", async () => {
    const seen: any[] = [];
    withClaude(async () => ({
      callTool: async (server: string, tool: string, input: unknown) => {
        seen.push({ server, tool, input });
        return { payload: { pagination: { total: 7234 } } };
      },
    }));
    const r = (await call("leadbay_pull_followups", { count: 1 })) as any;
    expect(seen[0].server).toBe("Leadbay"); // display name, not "leadbay"
    expect(seen[0].tool).toBe("leadbay_pull_followups");
    expect(seen[0].input).toEqual({ count: 1 });
    expect(r.pagination.total).toBe(7234);
  });

  it("falls back to the whole envelope when a connector sends no payload", async () => {
    withClaude(async () => ({
      callTool: async () => ({ content: [{ type: "text", text: '{"ok":true}' }] }),
    }));
    const r = (await call("leadbay_pull_followups", {})) as any;
    expect(r.ok).toBe(true); // normalize() parsed the text block
  });

  it("a domain component works over this transport end to end", async () => {
    withClaude(async () => ({
      callTool: async () => ({
        payload: {
          leads: [{ has_phone: true }, { contacts_count: 3 }],
          pagination: { total: 7234 },
        },
      }),
    }));
    const r = await lb.reachCoverage({ ask: "x" });
    expect(r.bookTotal).toBe(7234);
    expect(r.rows[0].total).toBe(1); // callable
    expect(r.rows[1].total).toBe(1); // contacts, no channel
  });

  it("cowork still wins when both transports are present", async () => {
    // cowork is the native surface; do not regress it.
    (globalThis as any).cowork = {
      callMcpTool: async () => ({ via: "cowork" }),
    };
    withClaude(async () => ({ callTool: async () => ({ payload: { via: "claude" } }) }));
    const r = (await call("leadbay_pull_followups", {})) as any;
    expect(r.via).toBe("cowork");
  });

  it("configure({server}) renames the connector for a differently-named one", async () => {
    const seen: string[] = [];
    withClaude(async () => ({
      callTool: async (server: string) => {
        seen.push(server);
        return { payload: {} };
      },
    }));
    configure({ server: "Leadbay Staging" });
    await call("leadbay_pull_followups", {});
    expect(seen[0]).toBe("Leadbay Staging");
  });

  it("a view that cannot run the capability degrades, it does not hang", async () => {
    // use("mcp") resolves null when the capability is not granted.
    withClaude(async () => null);
    await expect(call("leadbay_pull_followups", {})).rejects.toMatchObject({
      code: "unavailable",
    });
  });

  it("says what to fix, rather than naming an API the viewer never heard of", async () => {
    withClaude(async () => null);
    await expect(call("leadbay_pull_followups", {})).rejects.toThrow(/connector/i);
  });

  it("neither transport present is still `unavailable`, not a crash", async () => {
    await expect(call("leadbay_pull_followups", {})).rejects.toMatchObject({
      code: "unavailable",
    });
  });
});
