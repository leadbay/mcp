/**
 * Test harness for the LeadClaw OpenClaw tool plugin.
 *
 * Public API (stable):
 *   - createTestApi(config?)     fake `api` object capturing registerTool calls
 *   - executeTool(testApi, ...)  invoke a registered tool's execute()
 *   - mockHttp(scripts)          predicate-match mock for node:https
 *   - resetHttpMock()            clear scripts between tests
 *
 * Do NOT import from this file's internals in test files. The public API above
 * is all you need. When the OpenClaw SDK ships a tool-plugin test helper
 * (openclaw/plugin-sdk/testing), this file is the one-file swap.
 *
 * mockHttp note: matches each script once by {method, path} against the
 * outgoing https.request. Concurrent requests (e.g. Promise.allSettled in
 * get-lead-profile) are handled because matching is by-request, not FIFO.
 */

import { vi, expect } from "vitest";
import { EventEmitter } from "node:events";

export interface RegisteredTool {
  name: string;
  description: string;
  parameters: unknown;
  optional?: boolean;
  execute: (id: string, params: unknown) => unknown | Promise<unknown>;
}

export interface TestApi {
  api: {
    pluginConfig: Record<string, unknown>;
    logger: {
      info: (msg: string) => void;
      warn: (msg: string) => void;
      error: (msg: string) => void;
    };
    registerTool: (tool: RegisteredTool) => void;
  };
  tools: Map<string, RegisteredTool>;
  logs: { level: "info" | "warn" | "error"; msg: string }[];
}

export function createTestApi(pluginConfig: Record<string, unknown> = {}): TestApi {
  const tools = new Map<string, RegisteredTool>();
  const logs: { level: "info" | "warn" | "error"; msg: string }[] = [];
  const api = {
    pluginConfig,
    logger: {
      info: (msg: string) => logs.push({ level: "info", msg }),
      warn: (msg: string) => logs.push({ level: "warn", msg }),
      error: (msg: string) => logs.push({ level: "error", msg }),
    },
    registerTool: (tool: RegisteredTool) => {
      tools.set(tool.name, tool);
    },
  };
  return { api, tools, logs };
}

export async function executeTool(
  testApi: TestApi,
  name: string,
  params: unknown = {}
): Promise<unknown> {
  const tool = testApi.tools.get(name);
  if (!tool) {
    throw new Error(
      `executeTool: tool "${name}" not registered. Registered: [${Array.from(
        testApi.tools.keys()
      ).join(", ")}]`
    );
  }
  return tool.execute("test-id", params);
}

// ----------------------------------------------------------------------------
// mockHttp — predicate-match mock for node:https default import.
// ----------------------------------------------------------------------------

export interface RequestScript {
  method: string;
  path: string | RegExp;
  status: number;
  body?: string | object;
  error?: Error;
}

interface CapturedRequest {
  method: string;
  url: string;
  path: string;
  body?: string;
  headers: Record<string, string | number>;
}

// Hoisted so vi.mock's factory can see it. Not exported — access via helpers.
const mockHttpState = vi.hoisted(() => ({
  scripts: [] as Array<{ script: any; consumed: boolean }>,
  requests: [] as any[],
}));

export function mockHttp(scripts: RequestScript[]): { requests: CapturedRequest[] } {
  mockHttpState.scripts = scripts.map((s) => ({ script: s, consumed: false }));
  mockHttpState.requests = [];
  return { requests: mockHttpState.requests as CapturedRequest[] };
}

export function resetHttpMock(): void {
  mockHttpState.scripts = [];
  mockHttpState.requests = [];
}

export function getHttpRequests(): CapturedRequest[] {
  return mockHttpState.requests as CapturedRequest[];
}

function pathMatches(pattern: string | RegExp, path: string): boolean {
  if (pattern instanceof RegExp) return pattern.test(path);
  return pattern === path;
}

// The actual https.request replacement. Must match node:https contract closely
// enough that src/client.ts and src/tools/login.ts don't know the difference.
function fakeHttpsRequest(
  options: any,
  callback?: (res: any) => void
): any {
  const method = options.method ?? "GET";
  const path = options.path ?? "/";
  const hostname = options.hostname ?? "localhost";
  const url = `https://${hostname}${path}`;

  const captured: CapturedRequest = {
    method,
    url,
    path,
    headers: options.headers ?? {},
  };
  mockHttpState.requests.push(captured);

  const req = new EventEmitter() as any;
  let bodyBuffer = "";
  req.write = (chunk: string | Buffer) => {
    bodyBuffer += chunk.toString();
  };
  req.end = () => {
    captured.body = bodyBuffer || undefined;

    const entry = mockHttpState.scripts.find(
      (s) => !s.consumed && s.script.method === method && pathMatches(s.script.path, path)
    );

    if (!entry) {
      const registered = mockHttpState.scripts.map(
        (s: any) => `${s.script.method} ${s.script.path}${s.consumed ? " [used]" : ""}`
      );
      const err = new Error(
        `mockHttp: no script matched ${method} ${path}\n  registered: [${registered.join(
          ", "
        )}]`
      );
      setImmediate(() => req.emit("error", err));
      return;
    }

    entry.consumed = true;

    if (entry.script.error) {
      setImmediate(() => req.emit("error", entry.script.error));
      return;
    }

    const res = new EventEmitter() as any;
    res.statusCode = entry.script.status;
    setImmediate(() => {
      if (callback) callback(res);
      const bodyStr =
        typeof entry.script.body === "string"
          ? entry.script.body
          : entry.script.body != null
          ? JSON.stringify(entry.script.body)
          : "";
      if (bodyStr) res.emit("data", Buffer.from(bodyStr, "utf8"));
      res.emit("end");
    });
  };
  return req;
}

// vi.mock calls must be hoisted. We install the mock at the top of every test
// file that needs it via `vi.mock("node:https", () => ...)`. The shared factory
// below is what those mocks reference.
export const httpsMockModule = {
  default: { request: fakeHttpsRequest },
  request: fakeHttpsRequest,
};

// Convenience for test files. Use at module scope ABOVE any src imports:
//   vi.mock("node:https", () => httpsMockFactory());
export function httpsMockFactory() {
  return {
    default: { request: fakeHttpsRequest },
    request: fakeHttpsRequest,
  };
}

// Assertion helper: check that all scripts were consumed (no leftover mocks).
export function expectAllScriptsConsumed(): void {
  const leftover = mockHttpState.scripts
    .filter((s) => !s.consumed)
    .map((s: any) => `${s.script.method} ${s.script.path}`);
  if (leftover.length) {
    throw new Error(
      `mockHttp: ${leftover.length} unused script(s): [${leftover.join(", ")}]`
    );
  }
}

// Keep `expect` imported so vitest.config types resolve consistently.
void expect;
