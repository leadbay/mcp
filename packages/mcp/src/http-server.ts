// Self-hosted HTTP entry for Leadbay MCP.
//
// Exposes the same tool catalog as the stdio server (bin.ts) but over HTTP
// so multi-tenant hosts (ChatGPT custom connectors, web clients) can connect.
//
// Auth: MCP OAuth 2.0 proxy — the server acts as an MCP Authorization Server
// that proxies the OAuth flow to the regional Leadbay OAuth server. Clients
// (ChatGPT Desktop, Claude.ai, etc.) discover endpoints via the standard
// /.well-known/oauth-authorization-server metadata document and perform PKCE.
// The resulting Leadbay access token is then verified per-request.
//
// Endpoints:
//   GET  /.well-known/oauth-authorization-server  MCP OAuth metadata
//   GET  /.well-known/oauth-protected-resource     Protected resource metadata
//   POST /oauth/register                           Dynamic client registration (proxy)
//   GET  /oauth/authorize                          Authorization redirect (proxy)
//   POST /oauth/token                              Token exchange (proxy)
//   POST /mcp                                      Streamable HTTP transport
//   GET  /sse, POST /messages                      Legacy SSE transport
//   GET  /healthz                                  Liveness probe
//
// Run: `node dist/http-server.js` (PORT defaults to 8080).

import { randomUUID } from "node:crypto";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { mcpAuthRouter, mcpAuthMetadataRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { ProxyOAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/providers/proxyProvider.js";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { buildServer } from "./server.js";
import { resolveClientFromToken } from "./auth-http.js";
import { parseWriteEnv } from "./env.js";

declare const __LEADBAY_MCP_VERSION__: string;
const VERSION = typeof __LEADBAY_MCP_VERSION__ !== "undefined" ? __LEADBAY_MCP_VERSION__ : "0.0.0-dev";

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? "0.0.0.0";

// The public URL of this server — used as the OAuth issuer and in metadata.
// On Fly this is set via an env var; locally it falls back to localhost.
const SERVER_URL = (process.env.MCP_SERVER_URL ?? `http://localhost:${PORT}`).replace(/\/$/, "");

// Leadbay OAuth server base URL. Default: US region.
// Set LEADBAY_OAUTH_BASE_URL on the Fly app to pin a region.
const LEADBAY_OAUTH_BASE = (process.env.LEADBAY_OAUTH_BASE_URL ?? "https://api-us.leadbay.app").replace(/\/$/, "");

// ─── OAuth proxy provider ────────────────────────────────────────────────────

// In-memory store for registered OAuth clients (DCR).
// Production could swap this for Redis; for a single-instance Fly VM this is fine.
const registeredClients = new Map<string, OAuthClientInformationFull>();

const oauthProvider = new ProxyOAuthServerProvider({
  endpoints: {
    authorizationUrl: `${LEADBAY_OAUTH_BASE}/oauth/authorize`,
    tokenUrl: `${LEADBAY_OAUTH_BASE}/oauth/token`,
    revocationUrl: `${LEADBAY_OAUTH_BASE}/oauth/revoke`,
    registrationUrl: `${LEADBAY_OAUTH_BASE}/oauth/register`,
  },
  verifyAccessToken: async (token: string) => {
    // Verify by calling Leadbay /users/me — same as the per-request path.
    // We probe both regions so the server works regardless of account region.
    const { createClient } = await import("@leadbay/core");
    const probe = async (region: "us" | "fr") => {
      const client = createClient({ token, region });
      const me = await client.request<{ id: string; organization: { id: string } }>("GET", "/users/me");
      return { client, me, region };
    };
    try {
      const { me, region } = await Promise.any([probe("us"), probe("fr")]);
      return {
        token,
        clientId: "leadbay-mcp",
        scopes: [],
        expiresAt: undefined,
        extra: { userId: me.id, organizationId: me.organization.id, region },
      };
    } catch {
      throw new Error("Invalid or expired Leadbay access token");
    }
  },
  getClient: async (clientId: string) => {
    return registeredClients.get(clientId);
  },
});

// ─── Express app ─────────────────────────────────────────────────────────────

const app = express();

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, version: VERSION });
});

// MCP OAuth authorization server endpoints (/.well-known/*, /oauth/*, etc.)
app.use(mcpAuthRouter({
  provider: oauthProvider,
  issuerUrl: new URL(SERVER_URL),
  serviceDocumentationUrl: new URL("https://github.com/leadbay/leadclaw#readme"),
  scopesSupported: [],
  resourceName: "Leadbay MCP",
}));

// Protected resource metadata (points clients at this server's OAuth endpoints)
app.use(mcpAuthMetadataRouter({
  oauthMetadata: {
    issuer: SERVER_URL,
    authorization_endpoint: `${SERVER_URL}/oauth/authorize`,
    token_endpoint: `${SERVER_URL}/oauth/token`,
    registration_endpoint: `${SERVER_URL}/oauth/register`,
    response_types_supported: ["code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  },
  resourceServerUrl: new URL(`${SERVER_URL}/mcp`),
  serviceDocumentationUrl: new URL("https://github.com/leadbay/leadclaw#readme"),
  resourceName: "Leadbay MCP",
}));

// ─── Session map for legacy SSE transport ────────────────────────────────────

interface SseSession {
  transport: SSEServerTransport;
  server: Server;
  createdAt: number;
}
const sseSessions = new Map<string, SseSession>();

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractBearer(req: Request): string | undefined {
  const auth = req.headers["authorization"];
  if (!auth) return undefined;
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  return m ? m[1].trim() : undefined;
}

function extractRegion(req: Request): "us" | "fr" | undefined {
  const v = req.headers["x-leadbay-region"];
  if (v === "us" || v === "fr") return v;
  return undefined;
}

async function buildServerForRequest(
  token: string | undefined,
  region: "us" | "fr" | undefined
): Promise<Server> {
  const resolved = await resolveClientFromToken(token, { region });
  const includeWrite = parseWriteEnv();
  const includeAdvanced = process.env.LEADBAY_MCP_ADVANCED === "1";
  return buildServer(resolved.client, { version: VERSION, includeWrite, includeAdvanced });
}

// Body limit middleware (1 MB)
const rawBodyMiddleware = express.raw({
  type: ["application/json", "application/*+json"],
  limit: "1mb",
});

// ─── MCP Streamable HTTP transport ───────────────────────────────────────────

app.all("/mcp", rawBodyMiddleware, async (req: Request, res: Response) => {
  const token = extractBearer(req);
  const region = extractRegion(req);

  const mcpServer = await buildServerForRequest(token, region);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on("close", () => {
    transport.close().catch(() => {});
    mcpServer.close().catch(() => {});
  });

  try {
    await mcpServer.connect(transport);

    // Patch Accept header for clients that omit text/event-stream
    const accept = (req.headers["accept"] as string) ?? "";
    if (!accept.includes("text/event-stream")) {
      const patched = accept ? `${accept}, text/event-stream` : "application/json, text/event-stream";
      req.headers["accept"] = patched;
      const raw = (req as any).rawHeaders as string[];
      const idx = raw.findIndex((v: string, i: number) => i % 2 === 0 && v.toLowerCase() === "accept");
      if (idx >= 0) raw[idx + 1] = patched;
      else raw.push("accept", patched);
    }

    const body = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString()) : req.body;
    await transport.handleRequest(req as unknown as IncomingMessage, res as unknown as ServerResponse, body);
  } catch (err: any) {
    if (!res.headersSent) {
      res.status(500).json({ error: err?.message ?? "Internal server error" });
    }
    transport.close().catch(() => {});
    mcpServer.close().catch(() => {});
  }
});

// ─── Legacy SSE transport ────────────────────────────────────────────────────

app.get("/sse", async (req: Request, res: Response) => {
  const token = extractBearer(req);
  const region = extractRegion(req);

  const transport = new SSEServerTransport("/messages", res as unknown as ServerResponse);
  const mcpServer = await buildServerForRequest(token, region);
  await mcpServer.connect(transport);

  const sessionId = transport.sessionId;
  sseSessions.set(sessionId, { transport, server: mcpServer, createdAt: Date.now() });
  transport.onclose = () => {
    sseSessions.delete(sessionId);
    mcpServer.close().catch(() => {});
  };
  // Transport owns the response stream — do not call res.end() here.
});

app.post("/messages", rawBodyMiddleware, async (req: Request, res: Response) => {
  const sessionId = req.query["sessionId"] as string | undefined;
  if (!sessionId) {
    res.status(400).json({ error: "missing sessionId" });
    return;
  }
  const session = sseSessions.get(sessionId);
  if (!session) {
    res.status(404).json({ error: "unknown sessionId" });
    return;
  }
  const body = Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString()) : req.body;
  await session.transport.handlePostMessage(
    req as unknown as IncomingMessage,
    res as unknown as ServerResponse,
    body
  );
});

// ─── Boot ────────────────────────────────────────────────────────────────────

const _boot = randomUUID();
app.listen(PORT, HOST, () => {
  process.stderr.write(
    `leadbay-mcp-http ${VERSION} listening on http://${HOST}:${PORT} (boot=${_boot})\n` +
    `OAuth issuer: ${SERVER_URL}\n` +
    `Proxying OAuth to: ${LEADBAY_OAUTH_BASE}\n`
  );
});
