/**
 * Fixture MCP server — a real @leadbay/mcp stdio server with HTTP mocked.
 *
 * Usage (invoked as a child process by cli-session-runner):
 *   EVAL_FIXTURES=<base64-json> node fixture-mcp-server.js
 *
 * The EVAL_FIXTURES env var carries a base64-encoded JSON array of
 * BackendFixture objects (same shape as RunScenarioEvalOpts.backendFixtures).
 * On startup this script patches node:https before importing LeadbayClient,
 * so all outgoing HTTP calls are served from the fixtures.
 *
 * stdout/stdin carry the MCP stdio protocol — the claude CLI connects to
 * this process as an MCP server.
 */

// IMPORTANT: patch https BEFORE any other import that transitively requires
// node:https (LeadbayClient, buildServer). Module caching means once https
// is loaded the patch is live for the whole process.
import https from "node:https";
import { EventEmitter } from "node:events";

export interface BackendFixture {
  method: string;
  path: string | RegExp;
  status: number;
  body: unknown;
}

// Deserialise fixtures from env. RegExp paths were serialised as
// {__type:"RegExp", source, flags} by cli-session-runner.
function loadFixtures(): BackendFixture[] {
  const raw = process.env.EVAL_FIXTURES;
  if (!raw) return [];
  const parsed: Array<{
    method: string;
    path: string | { __type: "RegExp"; source: string; flags: string };
    status: number;
    body: unknown;
  }> = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  return parsed.map((f) => ({
    method: f.method,
    path:
      typeof f.path === "object" && f.path.__type === "RegExp"
        ? new RegExp(f.path.source, f.path.flags)
        : (f.path as string),
    status: f.status,
    body: f.body,
  }));
}

const fixtures = loadFixtures();
// Each fixture is consumed at most once (first-match-consume, same as harness).
const fixtureState = fixtures.map((f) => ({ fixture: f, consumed: false }));

function pathMatches(pattern: string | RegExp, path: string): boolean {
  if (pattern instanceof RegExp) return pattern.test(path);
  return pattern === path;
}

// Patch https.request to serve from fixtures.
const originalRequest = https.request.bind(https);
(https as unknown as { request: typeof https.request }).request = function patchedRequest(
  options: unknown,
  callback?: (res: unknown) => void,
): ReturnType<typeof https.request> {
  const opts = options as { method?: string; path?: string; hostname?: string };
  const method = opts.method ?? "GET";
  const path = opts.path ?? "/";

  const entry = fixtureState.find(
    (s) => !s.consumed && s.fixture.method === method && pathMatches(s.fixture.path, path),
  );

  if (!entry) {
    // No fixture matched — emit a clear error so the client doesn't hang.
    const req = new EventEmitter() as ReturnType<typeof https.request>;
    const noMatchErr = new Error(`fixture-mcp-server: no fixture matched ${method} ${path}`);
    (req as unknown as { write: (c: string | Buffer) => void }).write = () => {};
    (req as unknown as { end: () => void }).end = () => {
      setImmediate(() => (req as unknown as EventEmitter).emit("error", noMatchErr));
    };
    return req;
  }

  entry.consumed = true;
  const req = new EventEmitter() as ReturnType<typeof https.request>;
  let bodyBuf = "";
  (req as unknown as { write: (c: string | Buffer) => void }).write = (c: string | Buffer) => {
    bodyBuf += c.toString();
  };
  (req as unknown as { end: () => void }).end = () => {
    const res = new EventEmitter() as unknown as {
      statusCode: number;
      headers: Record<string, string>;
      emit: (event: string, ...args: unknown[]) => boolean;
    };
    (res as unknown as { statusCode: number }).statusCode = entry.fixture.status;
    (res as unknown as { headers: Record<string, string> }).headers = {};
    setImmediate(() => {
      if (callback) callback(res);
      const bodyStr =
        typeof entry.fixture.body === "string"
          ? entry.fixture.body
          : entry.fixture.body != null
          ? JSON.stringify(entry.fixture.body)
          : "";
      if (bodyStr) (res as unknown as EventEmitter).emit("data", Buffer.from(bodyStr, "utf8"));
      (res as unknown as EventEmitter).emit("end");
    });
  };
  return req;
} as typeof https.request;

// Now safe to import modules that use node:https.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { LeadbayClient } from "@leadbay/core";
import { buildServer } from "../../../src/server.js";

async function main(): Promise<void> {
  const baseUrl = process.env.EVAL_BASE_URL ?? "https://api-us.example";
  const bearer = process.env.EVAL_BEARER ?? "test-token-eval";

  const client = new LeadbayClient(baseUrl, bearer);
  const server = buildServer(client, { includeWrite: true, includeAdvanced: false });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server runs until the parent process closes stdin.
}

main().catch((err) => {
  process.stderr.write(`fixture-mcp-server fatal: ${err}\n`);
  process.exit(1);
});
