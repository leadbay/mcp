/**
 * Test harness for packages/core.
 *
 * Protocol-agnostic — no OpenClaw API surface. Tests invoke
 * `await someTool.execute(client, params, ctx?)` directly.
 *
 * Public API:
 *   - mockHttp(scripts)          predicate-match mock for node:https
 *   - resetHttpMock()            clear scripts between tests
 *   - httpsMockFactory()         returns the vi.mock factory object
 *   - expectAllScriptsConsumed() fail if any script was unused
 *   - createLogger()             captures logs so tests can assert ctx.logger calls
 */

import { vi, expect } from "vitest";
import { EventEmitter } from "node:events";
import type { ToolLogger } from "../src/types.js";

export interface RequestScript {
  method: string;
  path: string | RegExp;
  status: number;
  body?: string | object;
  error?: Error;
  // Optional HTTP response headers — useful for testing Retry-After parsing,
  // region tagging on errors, etc. Defaults to empty object.
  responseHeaders?: Record<string, string>;
}

export interface CapturedRequest {
  method: string;
  url: string;
  path: string;
  body?: string;
  headers: Record<string, string | number>;
}

// Hoisted so vi.mock's factory can see it.
const mockHttpState = vi.hoisted(() => ({
  scripts: [] as Array<{ script: any; consumed: boolean; replayed?: boolean }>,
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

function fakeHttpsRequest(options: any, callback?: (res: any) => void): any {
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

    let entry = mockHttpState.scripts.find(
      (s) => !s.consumed && s.script.method === method && pathMatches(s.script.path, path)
    );

    // Retry tolerance: the client auto-retries a 401 once (GET only). To model
    // exactly that — and nothing looser — replay the most recent CONSUMED script
    // for the same (method, path) AT MOST ONCE, and only when that script was a
    // 401 (the sole status the client retries). Bounding it this way keeps test
    // isolation: a code path that over-calls a route more than the single
    // sanctioned retry still falls through to the "no script matched" error.
    if (!entry) {
      const replay = [...mockHttpState.scripts]
        .reverse()
        .find(
          (s) =>
            s.consumed &&
            s.script.status === 401 &&
            !s.replayed &&
            s.script.method === method &&
            pathMatches(s.script.path, path)
        );
      if (replay) {
        replay.replayed = true;
        entry = replay;
      }
    }

    if (!entry) {
      const registered = mockHttpState.scripts.map(
        (s: any) => `${s.script.method} ${s.script.path}${s.consumed ? " [used]" : ""}`
      );
      const err = new Error(
        `mockHttp: no script matched ${method} ${path}\n  registered: [${registered.join(", ")}]`
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
    // Provide an empty headers object by default so client code that reads
    // res.headers (Retry-After, etc.) works. Individual scripts may override
    // via script.responseHeaders.
    res.headers = (entry.script as any).responseHeaders ?? {};
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

export const httpsMockModule = {
  default: { request: fakeHttpsRequest },
  request: fakeHttpsRequest,
};

export function httpsMockFactory() {
  return {
    default: { request: fakeHttpsRequest },
    request: fakeHttpsRequest,
  };
}

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

export interface CapturedLog {
  level: "info" | "warn" | "error";
  msg: string;
}

export function createLogger(): { logger: ToolLogger; logs: CapturedLog[] } {
  const logs: CapturedLog[] = [];
  const logger: ToolLogger = {
    info: (msg: string) => logs.push({ level: "info", msg }),
    warn: (msg: string) => logs.push({ level: "warn", msg }),
    error: (msg: string) => logs.push({ level: "error", msg }),
  };
  return { logger, logs };
}

void expect;
