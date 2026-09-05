/**
 * The no-cancel rule, end to end, as a hosted connector actually receives it.
 *
 * The audit in `test/audit/launched-work-not-cancellable.test.ts` reads the
 * `Tool` objects the catalogue exports. This drives the real Hono app on a real
 * socket through `StreamableHTTPServerTransport` and reads `tools/list`, which
 * is the only thing a chat host ever sees. It catches what the audit cannot: a
 * description that never reaches the wire, one truncated in transit, and the
 * wrong variant reaching a tool.
 *
 * Two variants ship, and giving a tool the wrong one costs the user money:
 *
 *  - The composite launchers and the status tools call `beginLaunch`, so a
 *    re-call inside the window hands back the job already launched.
 *  - The granular launchers POST directly and never call it, so the same advice
 *    would invite a second paid launch.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "./harness.js";

vi.mock("node:https", () => httpsMockFactory());

import { serve } from "@hono/node-server";
import { app } from "../src/http-server.js";

const TOKEN = "u.token-org-a_us";
const ME = {
  method: "GET" as const,
  path: "/1.6/users/me",
  status: 200,
  body: {
    id: "user-A",
    email: "a@example.com",
    organization: { id: "org-A" },
    admin: true,
    last_requested_lens: "77",
  },
};

// Guarded: `beginLaunch` / `rememberLaunch` in the composite, so a re-call
// inside the five-minute window returns the ids the first call produced.
const GUARDED = [
  "leadbay_enrich_titles",
  "leadbay_bulk_qualify_leads",
  "leadbay_import_and_qualify",
];

// Read-only. Re-calling them launches nothing, so they must NOT carry the
// launcher's "check account_status before you spend quota again" text — that
// stalls the poll loop they exist for.
const POLL_ONLY = [
  "leadbay_bulk_enrich_status",
  "leadbay_qualify_status",
  "leadbay_import_status",
];

// The text that must never come back, in any tool: the retired store's model.
const RETIRED = [
  "BULK_CANCELLED",
  "no further work is in flight",
  "no further qualifications are in flight",
  "the cancelled record won't block a fresh launch",
];

const MAX_CHARS = 17_000;

async function boot(): Promise<{ close: () => void; url: string }> {
  const server: any = await new Promise((resolve) => {
    const s = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, () => resolve(s));
  });
  return { close: () => server.close(), url: `http://127.0.0.1:${server.address().port}/mcp` };
}

async function rawTools(url: string): Promise<any[]> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  return ((await res.json()) as any).result?.tools ?? [];
}

async function listTools(url: string): Promise<Map<string, string>> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  const json = (await res.json()) as any;
  const tools = json.result?.tools ?? [];
  // Collapse whitespace: the snippets are hard-wrapped markdown, so a sentence
  // can straddle a newline and a raw substring match would depend on where.
  return new Map<string, string>(
    tools.map((t: any) => [t.name, String(t.description ?? "").replace(/\s+/g, " ")])
  );
}

beforeEach(() => resetHttpMock());

describe("the no-cancel rule reaches a hosted connector (product#4039)", () => {
  it("every guarded launcher carries the rule and its branches", async () => {
    mockHttp([ME]);
    const { close, url } = await boot();
    try {
      const byName = await listTools(url);
      for (const name of GUARDED) {
        const d = byName.get(name);
        expect(d, `${name} is missing from tools/list`).toBeTypeOf("string");
        expect(d, name).toContain("Leadbay has no cancel");
        // The three branches recovery actually splits into.
        expect(d, name).toContain("do not launch the work that handle covers a second time");
        expect(d, name).toContain('error:"not_queued"');
        expect(d, name).toContain("hand back the job already launched");
        expect(d, name).toContain("best-effort");
      }
    } finally {
      close();
    }
  });

  // `leadbay_enrich_contacts` is the one unguarded launcher the hosted route
  // exposes, so it is the one a real connector user can double-spend on.
  it("every status tool is told polling is free, without the launcher warning", async () => {
    mockHttp([ME]);
    const { close, url } = await boot();
    try {
      const byName = await listTools(url);
      for (const name of POLL_ONLY) {
        const d = byName.get(name);
        expect(d, `${name} is missing from tools/list`).toBeTypeOf("string");
        expect(d, name).toContain("Leadbay has no cancel");
        expect(d, name).toContain("This tool only reads");
        expect(d, name).toContain("a timeout here is a reason to call it again, not a reason to stop");
        // The launcher variant would make the assistant hesitate to re-poll.
        expect(d, name).not.toContain("hand back the job already launched");
      }
    } finally {
      close();
    }
  });

  it("leadbay_enrich_contacts is told it has NO guard, not the guarded advice", async () => {
    mockHttp([ME]);
    const { close, url } = await boot();
    try {
      const d = (await listTools(url)).get("leadbay_enrich_contacts");
      expect(d, "leadbay_enrich_contacts is missing from tools/list").toBeTypeOf("string");
      expect(d).toContain("Leadbay has no cancel");
      expect(d).toContain("no double-launch guard");
      expect(d).toContain("`dry_run` result reached no backend and spent nothing");
      expect(d).toContain("calling it again always issues a new paid launch");
      // The guarded variant would tell it to just re-call. That spends twice.
      expect(d).not.toContain("hand back the job already launched");
    } finally {
      close();
    }
  });

  it("leadbay_import_leads carries its own sentence, including the no-handle re-call", async () => {
    mockHttp([ME]);
    const { close, url } = await boot();
    try {
      const d = (await listTools(url)).get("leadbay_import_leads");
      expect(d).toContain("Leadbay has no cancel");
      expect(d).toContain("Sole exception: a `wait_for_completion:false` call that returned NOTHING");
      expect(d).toContain("even that can re-upload");
    } finally {
      close();
    }
  });

  // The prose says every call is a new paid launch. `idempotentHint` is the
  // machine-readable half of the same claim and it shipped saying the opposite,
  // so a host could auto-retry a paid launch on the strength of it.
  it("leadbay_enrich_contacts advertises itself as NON-idempotent", async () => {
    mockHttp([ME]);
    const { close, url } = await boot();
    try {
      const t = (await rawTools(url)).find((x) => x.name === "leadbay_enrich_contacts");
      expect(t, "leadbay_enrich_contacts is missing from tools/list").toBeDefined();
      expect(t.annotations?.idempotentHint).toBe(false);
      expect(t.annotations?.destructiveHint).toBe(true);
    } finally {
      close();
    }
  });

  it("no tool on the wire carries the retired store's model, or exceeds the budget", async () => {
    mockHttp([ME]);
    const { close, url } = await boot();
    try {
      const byName = await listTools(url);
      expect(byName.size).toBeGreaterThan(30);
      const offenders: string[] = [];
      const oversize: string[] = [];
      for (const [name, d] of byName) {
        for (const phrase of RETIRED) {
          if (d.toLowerCase().includes(phrase.toLowerCase())) offenders.push(`${name}: ${phrase}`);
        }
        if (d.length > MAX_CHARS) oversize.push(`${name}: ${d.length}`);
      }
      expect(offenders).toEqual([]);
      expect(oversize).toEqual([]);
    } finally {
      close();
    }
  });
});
