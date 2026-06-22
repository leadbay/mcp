import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// END-TO-END DOGFOOD (manager) — an INDEPENDENT agent built this dashboard from
// only the usage guide. We inject the real runtime, stub the bridge, and assert
// the manager scenario works: the leaderboard POPULATES from leadbay_team_activity
// (the new MCP tool), the window switcher re-loads for a new range, and Refresh
// re-reads. Green = an agent can build a manager dashboard on lb.teamActivity.

const ROOT = process.cwd();
const FIXTURE = resolve(ROOT, "test/fixtures/agent-manager-dashboard.html");
const GENERATED = resolve(ROOT, "../core/src/artifact-runtime.generated.ts");

function shippedRuntime(): string {
  const src = readFileSync(GENERATED, "utf8");
  const m = src.match(/ARTIFACT_RUNTIME: string = ("(?:[^"\\]|\\.)*");/);
  if (!m) throw new Error("ARTIFACT_RUNTIME not found in generated module");
  return JSON.parse(m[1]) as string;
}

const TEAM = {
  range: { from: "2026-05-21", to: "2026-06-18", periodicity: "WEEKLY" },
  reps: [
    { user_id: "u-ben", name: "Ben", email: "ben@x.co", total_activities: 90, notes: 30, meetings_or_interest: 7, lost: 0 },
    { user_id: "u-anna", name: "Anna", email: "anna@x.co", total_activities: 40, notes: 12, meetings_or_interest: 4, lost: 2 },
  ],
  trend: [{ date: "2026-06-01", count: 20 }, { date: "2026-06-08", count: 35 }],
};

interface Call {
  tool: string;
  args: Record<string, any>;
}

function boot() {
  const html = readFileSync(FIXTURE, "utf8").replace(
    "<!-- RUNTIME_HERE -->",
    `<script>${shippedRuntime()}</script>`,
  );
  const calls: Call[] = [];
  const dom = new JSDOM(html, {
    runScripts: "dangerously",
    beforeParse(window) {
      (window as any).cowork = {
        callMcpTool: (tool: string, args: Record<string, any>) => {
          calls.push({ tool, args });
          return Promise.resolve({ structuredContent: TEAM });
        },
      };
    },
  });
  return { dom, calls, doc: dom.window.document };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const teamCalls = (calls: Call[]) => calls.filter((c) => c.tool === "leadbay_team_activity");

describe("agent-built manager dashboard drives leadbay_team_activity", () => {
  it("populates the leaderboard FROM leadbay_team_activity (default 4-week window)", async () => {
    const { doc, calls } = boot();
    await tick();

    const tc = teamCalls(calls);
    expect(tc.length).toBe(1);
    expect(tc[0].args.weeks).toBe(4);
    expect(typeof tc[0].args._triggered_by).toBe("string");

    const rows = [...doc.querySelectorAll("#leaderboard tr.rep-row")];
    expect(rows.length).toBe(2);
    // Sorted leaderboard: Ben first.
    expect(rows[0].querySelector(".rep-name .nm")?.textContent).toBe("Ben");
    expect(rows[0].querySelector(".rep-activities .av")?.textContent).toBe("90");
    expect(rows[1].querySelector(".rep-name .nm")?.textContent).toBe("Anna");
  });

  it("the window switcher reloads team_activity for the chosen window", async () => {
    const { doc, calls } = boot();
    await tick();
    const btn12 = doc.querySelector('.window-btn[data-weeks="12"]') as HTMLButtonElement;
    btn12.click();
    await tick();

    const tc = teamCalls(calls);
    expect(tc.length).toBe(2);
    expect(tc[1].args.weeks).toBe(12); // new window requested
  });

  it("Refresh re-reads the current window", async () => {
    const { doc, calls } = boot();
    await tick();
    (doc.getElementById("refresh") as HTMLButtonElement).click();
    await tick();
    expect(teamCalls(calls).length).toBe(2); // initial + refresh
  });
});
