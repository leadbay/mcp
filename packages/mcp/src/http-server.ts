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
import type { IncomingMessage, ServerResponse } from "node:http";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { serve } from "@hono/node-server";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { buildServer } from "./server.js";
import { resolveClientFromToken } from "./auth-http.js";
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

function extractRegion(headerValue: string | undefined): "us" | "fr" | undefined {
  if (headerValue === "us" || headerValue === "fr") return headerValue;
  return undefined;
}

// Build a fresh MCP server bound to the caller's bearer token. One server per
// session — keeps tenant isolation explicit and avoids any cross-request
// state leaking through the LeadbayClient.
async function buildServerForRequest(
  token: string | undefined,
  region: "us" | "fr" | undefined
): Promise<Server> {
  const resolved = await resolveClientFromToken(token, { region });
  const includeWrite = parseWriteEnv();
  const includeAdvanced = process.env.LEADBAY_MCP_ADVANCED === "1";
  return buildServer(resolved.client, {
    version: VERSION,
    includeWrite,
    includeAdvanced,
  });
}

const app = new Hono();

app.get("/healthz", (c) => c.json({ ok: true, version: VERSION }));

// Cap request bodies at 1 MB to prevent OOM on the 256 MB Fly VM.
const MCP_BODY_LIMIT = bodyLimit({ maxSize: 1 * 1024 * 1024 });
app.use("/mcp", MCP_BODY_LIMIT);
app.use("/messages", MCP_BODY_LIMIT);

// Streamable HTTP transport. Stateless mode (no sessionIdGenerator) is the
// simplest fit for ChatGPT custom connectors today — each request is its own
// MCP session. If we need long-lived state we can flip to stateful later by
// passing `sessionIdGenerator: randomUUID`.
app.all("/mcp", async (c) => {
  const token = extractBearer(c.req.header("authorization"));
  const region = extractRegion(c.req.header("x-leadbay-region"));

  const server = await buildServerForRequest(token, region);
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
});

// Legacy SSE transport. Two endpoints: GET /sse opens the stream, POST
// /messages?sessionId=... feeds JSON-RPC messages in.
app.get("/sse", async (c) => {
  const token = extractBearer(c.req.header("authorization"));
  const region = extractRegion(c.req.header("x-leadbay-region"));

  const env = c.env as { incoming: IncomingMessage; outgoing: ServerResponse };
  const transport = new SSEServerTransport("/messages", env.outgoing);
  const server = await buildServerForRequest(token, region);
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
});

app.post("/messages", async (c) => {
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

// Stable boot log for Fly to surface in the dashboard.
const _boot = randomUUID();
serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
  process.stderr.write(
    `leadbay-mcp-http ${VERSION} listening on http://${info.address}:${info.port} (boot=${_boot})\n`
  );
});
