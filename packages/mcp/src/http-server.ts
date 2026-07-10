// Self-hosted HTTP entry for Leadbay MCP.
//
// Exposes the same tool catalog as the stdio server (bin.ts) but over HTTP
// so multi-tenant hosts (ChatGPT custom connectors, web clients) can connect.
// Each request carries its own bearer token in the Authorization header; we
// build a fresh LeadbayClient + MCP Server per session and tear them down on
// close.
//
// Endpoints:
//   POST /mcp                  Streamable HTTP transport (current MCP spec)
//   GET  /sse, POST /messages  Legacy SSE transport (older hosts)
//   GET  /healthz              Liveness probe for Fly/Render
//
// Run: `node dist/http-server.js` (PORT defaults to 8080).

import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { serve } from "@hono/node-server";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { LeadbayClient } from "@leadbay/core";
import { buildServer } from "./server.js";
import {
  resolveClientFromToken,
  protectedResourceMetadata,
  buildWwwAuthenticate,
} from "./auth-http.js";
import { parseWriteEnv } from "./env.js";

declare const __LEADBAY_MCP_VERSION__: string;
const VERSION = typeof __LEADBAY_MCP_VERSION__ !== "undefined" ? __LEADBAY_MCP_VERSION__ : "0.0.0-dev";

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? "0.0.0.0";

// In-memory session map for the legacy SSE transport. Streamable HTTP keeps
// its own session table inside the transport instance, so we only need to
// track SSE sessions ourselves (the POST /messages endpoint needs to route
// the body to the right transport by sessionId).
interface SseSession {
  transport: SSEServerTransport;
  server: Server;
  createdAt: number;
}
const sseSessions = new Map<string, SseSession>();

// Evict SSE sessions that have been open longer than 30 minutes. Protects
// against zombie entries where transport.onclose never fires (network drop,
// half-open TCP) on the 256 MB Fly VM.
const SSE_SESSION_TTL_MS = 30 * 60 * 1000;
setInterval(() => {
  const cutoff = Date.now() - SSE_SESSION_TTL_MS;
  for (const [id, session] of sseSessions) {
    if (session.createdAt < cutoff) {
      sseSessions.delete(id);
      session.transport.close().catch(() => {});
      session.server.close().catch(() => {});
    }
  }
}, 5 * 60 * 1000).unref();

function extractBearer(authHeader: string | undefined): string | undefined {
  if (!authHeader) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader);
  return m ? m[1].trim() : undefined;
}

// Build a fresh MCP server bound to the caller's resolved client. One server per
// session — keeps tenant isolation explicit and avoids any cross-request state
// leaking through the LeadbayClient.
function buildServerFromClient(client: LeadbayClient): Server {
  const includeWrite = parseWriteEnv();
  const includeAdvanced = process.env.LEADBAY_MCP_ADVANCED === "1";
  return buildServer(client, { version: VERSION, includeWrite, includeAdvanced });
}

// ── OAuth resource-server discovery (MCP authorization spec / RFC 9728) ──────
//
// Stargate is the single, region-agnostic OAuth authority. Discovery advertises
// ONE authorization server for everyone, so the shared connector URL works for
// any region — no `/us` vs `/fr` connector path. The user's region is decided at
// consent and rides in the token's `_us`/`_fr` suffix, so tool requests route by
// the token, not the URL.

const PRM_PREFIX = "/.well-known/oauth-protected-resource";
const RESOURCE_PATHS = ["/mcp", "/sse"] as const;

// Public origin of this request. Fly terminates TLS and forwards over http, so
// trust x-forwarded-proto; fall back to the request URL (host + scheme).
function requestOrigin(c: Context): string {
  const url = new URL(c.req.url);
  const proto = c.req.header("x-forwarded-proto") ?? url.protocol.replace(/:$/, "");
  const host = c.req.header("host") ?? url.host;
  return `${proto}://${host}`;
}

function applyCors(c: Context): void {
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Expose-Headers", "WWW-Authenticate");
}

// ── Origin validation (DNS-rebinding defense, MCP HTTP transport spec) ───────
//
// A malicious web page can POST to a local/remote MCP endpoint from the user's
// browser; the MCP spec requires servers to validate the `Origin` header to
// reject those. We allowlist the connector hosts that legitimately drive this
// server from a browser context (Claude web/desktop, ChatGPT) plus any extra
// origins an operator pins via LEADBAY_MCP_ALLOWED_ORIGINS (comma-separated).
//
// `Origin` is a browser-only header: native MCP clients (Claude Desktop's MCP
// runtime, Codex, curl, server-to-server) send NO Origin, and rejecting its
// absence would break every non-browser caller. So the rule is: absent Origin →
// allow; present-and-allowlisted → allow; present-and-foreign → 403. Discovery
// (PRM) and OPTIONS stay world-open (`*`) — PRM must be world-readable per RFC
// 9728 and a 403 there would break the sign-in handshake.
const DEFAULT_ALLOWED_ORIGINS = [
  "https://claude.ai",
  "https://claude.com",
  "https://chatgpt.com",
];

function allowedOrigins(): Set<string> {
  const extra = (process.env.LEADBAY_MCP_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_ORIGINS, ...extra]);
}

// Returns a 403 Response if the request carries a present, non-allowlisted
// Origin; otherwise null (caller proceeds). The server's own origin is always
// allowed so same-origin browser fetches and self-probes work.
function rejectForeignOrigin(c: Context): Response | null {
  const origin = c.req.header("origin");
  if (!origin) return null; // non-browser caller — no Origin to validate
  const allowed = allowedOrigins();
  allowed.add(requestOrigin(c)); // same-origin requests
  if (allowed.has(origin)) return null;
  applyCors(c);
  return c.json({ error: "forbidden origin" }, 403);
}

// RFC 9728 Protected Resource Metadata. Served unauthenticated with permissive
// CORS so the desktop client can fetch it during discovery.
function servePrm(c: Context, resourcePath: string): Response {
  applyCors(c);
  c.header("Cache-Control", "public, max-age=3600");
  return c.json(
    protectedResourceMetadata({
      resourceUrl: `${requestOrigin(c)}${resourcePath}`,
    })
  );
}

// 401 challenge carrying WWW-Authenticate → triggers the client's OAuth sign-in
// flow (MCP auth spec). Without this the client never prompts (the reported bug).
function sendChallenge(
  c: Context,
  resourcePath: string,
  authState: "missing" | "expired"
): Response {
  const resourceMetadataUrl = `${requestOrigin(c)}${PRM_PREFIX}${resourcePath}`;
  applyCors(c);
  c.header("WWW-Authenticate", buildWwwAuthenticate({ resourceMetadataUrl, authState }));
  // Empty body on purpose (product#3761). The OAuth challenge contract is the
  // 401 status + the WWW-Authenticate header (RFC 6750 §3 / RFC 9728) — a
  // spec-compliant client drives sign-in/refresh entirely from those and never
  // reads the body. The expired-vs-missing signal already rides in the header
  // (error="invalid_token" for expired). But Claude's host surfaces any 401
  // body prose to the LLM, which then parrots a spurious "sign in with Leadbay
  // again" to the user even though the host silently refreshes the token and
  // the immediate retry succeeds. No body → nothing for the agent to
  // hallucinate as a re-auth instruction.
  return c.body(null, 401);
}

const app = new Hono();

app.get("/healthz", (c) => c.json({ ok: true, version: VERSION }));

// Protected resource metadata: bare path serves the primary /mcp resource; the
// RFC 9728 path-suffix form (…/oauth-protected-resource/mcp, /fr/mcp, /sse, …)
// lets each connector URL advertise its own region's authorization server.
app.get(PRM_PREFIX, (c) => servePrm(c, "/mcp"));
app.get(`${PRM_PREFIX}/*`, (c) => {
  const suffix = c.req.path.slice(PRM_PREFIX.length);
  const resourcePath = (RESOURCE_PATHS as readonly string[]).includes(suffix) ? suffix : "/mcp";
  return servePrm(c, resourcePath);
});

// CORS preflight for discovery + MCP endpoints (browser-based remote clients).
// Registered before the route handlers so OPTIONS never falls into an auth gate.
app.options("*", (c) => {
  applyCors(c);
  c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  c.header(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id"
  );
  return c.body(null, 204);
});

// Cap request bodies at 1 MB to prevent OOM on the 256 MB Fly VM.
const MCP_BODY_LIMIT = bodyLimit({ maxSize: 1 * 1024 * 1024 });
app.use("/mcp", MCP_BODY_LIMIT);
app.use("/messages", MCP_BODY_LIMIT);

// Streamable HTTP transport. Stateless mode (no sessionIdGenerator) is the
// simplest fit for ChatGPT custom connectors today — each request is its own
// MCP session. If we need long-lived state we can flip to stateful later by
// passing `sessionIdGenerator: randomUUID`.
async function handleStreamable(
  c: Context,
  resourcePath: "/mcp"
): Promise<Response> {
  const foreign = rejectForeignOrigin(c);
  if (foreign) return foreign;

  const token = extractBearer(c.req.header("authorization"));

  // Auto-probe (no region pin) so a missing OR invalid/expired token both yield
  // a 401 challenge, and a valid token routes to whichever region owns it.
  const resolved = await resolveClientFromToken(token);
  if (resolved.authState === "missing" || resolved.authState === "expired") {
    return sendChallenge(c, resourcePath, resolved.authState);
  }

  const server = buildServerFromClient(resolved.client);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    // Return JSON responses instead of SSE so non-SSE clients (e.g. Codex) work.
    enableJsonResponse: true,
  });

  // Tear down server + transport when the response closes. Without this the
  // LeadbayClient would linger until GC.
  c.req.raw.signal.addEventListener("abort", () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });

  try {
    await server.connect(transport);

    // Hono's Node adapter exposes the underlying req/res via `c.env.incoming`
    // and `c.env.outgoing` (see @hono/node-server). The MCP transport needs
    // those raw Node objects.
    const env = c.env as { incoming: IncomingMessage; outgoing: ServerResponse };
    const parsedBody = c.req.header("content-type")?.includes("application/json")
      ? await c.req.json().catch(() => undefined)
      : undefined;

    // Some clients (e.g. Codex v0.133) send only "application/json" but the MCP
    // spec requires both "application/json" and "text/event-stream". The SDK reads
    // rawHeaders (not headers), so we must patch both arrays.
    const accept = env.incoming.headers["accept"] ?? "";
    if (!accept.includes("text/event-stream")) {
      const patched = accept ? `${accept}, text/event-stream` : "application/json, text/event-stream";
      env.incoming.headers["accept"] = patched;
      const raw = env.incoming.rawHeaders;
      const idx = raw.findIndex((v, i) => i % 2 === 0 && v.toLowerCase() === "accept");
      if (idx >= 0) {
        raw[idx + 1] = patched;
      } else {
        raw.push("accept", patched);
      }
    }

    await transport.handleRequest(env.incoming, env.outgoing, parsedBody);
    // The transport has already written headers + body to env.outgoing.
    // Tell Hono's Node adapter to skip its own write (otherwise it sets a
    // wrong Content-Length that breaks strict HTTP clients like Codex/rmcp).
    return new Response(null, { headers: { "x-hono-already-sent": "1" } });
  } finally {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  }
}

app.all("/mcp", (c) => handleStreamable(c, "/mcp"));

// Legacy SSE transport. Two endpoints: GET /sse opens the stream, POST
// /messages?sessionId=... feeds JSON-RPC messages in.
async function handleSse(c: Context, resourcePath: "/sse"): Promise<Response> {
  const foreign = rejectForeignOrigin(c);
  if (foreign) return foreign;

  const token = extractBearer(c.req.header("authorization"));

  const resolved = await resolveClientFromToken(token);
  if (resolved.authState === "missing" || resolved.authState === "expired") {
    return sendChallenge(c, resourcePath, resolved.authState);
  }

  const env = c.env as { incoming: IncomingMessage; outgoing: ServerResponse };
  const transport = new SSEServerTransport("/messages", env.outgoing);
  const server = buildServerFromClient(resolved.client);
  await server.connect(transport);

  const sessionId = transport.sessionId;
  sseSessions.set(sessionId, { transport, server, createdAt: Date.now() });
  transport.onclose = () => {
    sseSessions.delete(sessionId);
    server.close().catch(() => {});
  };

  // Transport has written headers + endpoint event to env.outgoing and owns
  // the stream until the client disconnects. Use the same sentinel as /mcp so
  // Hono's Node adapter does not attempt a second header write.
  return new Response(null, { headers: { "x-hono-already-sent": "1" } });
}

app.get("/sse", (c) => handleSse(c, "/sse"));

app.post("/messages", async (c) => {
  const foreign = rejectForeignOrigin(c);
  if (foreign) return foreign;

  const sessionId = c.req.query("sessionId");
  if (!sessionId) {
    return c.json({ error: "missing sessionId" }, 400);
  }
  const session = sseSessions.get(sessionId);
  if (!session) {
    return c.json({ error: "unknown sessionId" }, 404);
  }
  const env = c.env as { incoming: IncomingMessage; outgoing: ServerResponse };
  const body = await c.req.json().catch(() => undefined);
  await session.transport.handlePostMessage(env.incoming, env.outgoing, body);
  // handlePostMessage has already written the response to env.outgoing.
  return new Response(null, { headers: { "x-hono-already-sent": "1" } });
});

// Exported so tests can drive routes via `app.fetch(new Request(...))` without
// binding a port. The listener below only starts when run as the entrypoint.
export { app };

// Run the HTTP listener only when invoked directly (node dist/http-server.js),
// not when imported by tests. Mirrors the entrypoint guard in bin.ts.
const isEntrypoint = (() => {
  try {
    const entry = process.argv[1];
    if (!entry) return false;
    const entryName = basename(entry).toLowerCase();
    if (entryName !== "http-server.js" && entryName !== "leadbay-mcp-http") return false;
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry);
  } catch {
    return false;
  }
})();

if (isEntrypoint) {
  // Stable boot log for Fly to surface in the dashboard.
  const _boot = randomUUID();
  serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
    process.stderr.write(
      `leadbay-mcp-http ${VERSION} listening on http://${info.address}:${info.port} (boot=${_boot})\n`
    );
  });
}
