/**
 * Test harness for @leadbay/mcp — mirrors packages/core/test/harness.ts
 * so we can drive the server with mocked HTTP.
 */

import { vi } from "vitest";
import { EventEmitter } from "node:events";

export interface RequestScript {
  method: string;
  path: string | RegExp;
  status: number;
  body?: string | object;
  error?: Error;
}

export interface CapturedRequest {
  method: string;
  url: string;
  path: string;
  body?: string;
  headers: Record<string, string | number>;
}

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
    const entry = mockHttpState.scripts.find(
      (s) => !s.consumed && s.script.method === method && pathMatches(s.script.path, path)
    );
    if (!entry) {
      const err = new Error(`mockHttp: no script matched ${method} ${path}`);
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

export function httpsMockFactory() {
  return {
    default: { request: fakeHttpsRequest },
    request: fakeHttpsRequest,
  };
}
