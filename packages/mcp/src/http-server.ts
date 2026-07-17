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
import type { LeadbayClient, ToolLogger } from "@leadbay/core";
import { buildServer } from "./server.js";
import {
  resolveClientFromToken,
  protectedResourceMetadata,
  buildWwwAuthenticate,
} from "./auth-http.js";
import { parseWriteEnv } from "./env.js";
import {
  initTelemetry,
  type CaptureIdentity,
  type TelemetryHandle,
} from "./telemetry.js";

declare const __LEADBAY_MCP_VERSION__: string;
const VERSION = typeof __LEADBAY_MCP_VERSION__ !== "undefined" ? __LEADBAY_MCP_VERSION__ : "0.0.0-dev";

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? "0.0.0.0";

// Stderr logger. The HTTP server has no JSON-RPC-on-stdout constraint (that's
// stdio only), but keep telemetry/auth logging on stderr to match the boot log.
const logger: ToolLogger = {
  info: (m: string) => process.stderr.write(`[leadbay-mcp-http info] ${m}\n`),
  warn: (m: string) => process.stderr.write(`[leadbay-mcp-http warn] ${m}\n`),
  error: (m: string) => process.stderr.write(`[leadbay-mcp-http error] ${m}\n`),
};

// ONE process-level telemetry handle, reused across every request. Batching
// defaults (flushAt:20 / flushInterval:10_000) suit the long-lived Fly process;
// the tail is flushed by the SIGTERM/SIGINT hook at the entrypoint. Identity is
// NOT resolved here — this server is multi-tenant, so each request binds its own
// identity via bindTelemetryIdentity() below. initTelemetry returns NOOP when
// telemetry is disabled (LEADBAY_TELEMETRY_ENABLED=false / NODE_ENV=test / no
// keys), so the call sites stay branch-free.
const telemetry: TelemetryHandle = initTelemetry({ version: VERSION, logger });

// Max time to wait on /users/me for a request's telemetry identity before
// giving up and attributing to "mcp:unknown". Bounds the worst case so a hung
// /users/me can never delay a tool response on the telemetry path.
const IDENTITY_RESOLVE_TIMEOUT_MS = 1500;

// Resolve the PostHog identity for a request from its own (per-request) client.
// The auth probe used client.request("GET","/users/me") directly rather than
// resolveMe(), so this is a fresh fetch — but it's bounded, 60s-cached per
// client (so a multi-call SSE session pays once), and never blocks the tool: on
// timeout or error we attribute to "mcp:unknown" so the event STILL lands.
export async function resolveIdentity(client: LeadbayClient): Promise<CaptureIdentity> {
  return (await resolveTelemetryContext(client)).identity;
}

// Resolve BOTH the per-request PostHog identity AND whether the user has opted
// out of telemetry (telemetry_enabled — product#3879), from a single bounded
// /users/me.
//
// FAIL CLOSED on an unknown preference (Codex P1): when /users/me times out or
// errors we cannot see the user's telemetry_enabled, so we return enabled:false
// and emit NOTHING for that request. Rationale: this is the enforcement point
// for a privacy opt-out — leaking an opted-out user's telemetry on transient API
// slowness is a consent violation and is NOT recoverable (the event is already
// sent), whereas the cost of failing closed is only a dropped data point for an
// enabled user on that one request (self-corrects on the next successful read).
// Note: an absent telemetry_enabled on a SUCCESSFUL read still means enabled
// (older backend / opt-out default) — that's a known preference, not an unknown one.
async function resolveTelemetryContext(
  client: LeadbayClient
): Promise<{ identity: CaptureIdentity; enabled: boolean; forceClosed: boolean }> {
  const region = client.region;
  try {
    const me = await Promise.race([
      client.resolveMe(),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), IDENTITY_RESOLVE_TIMEOUT_MS)
      ),
    ]);
    // Unknown preference (TIMEOUT) → fail closed HARD. The losing resolveMe()
    // keeps running in the background and can populate the cache with a `true`
    // AFTER this returns; forceClosed must override that so a request the
    // timeout decided to suppress cannot reopen itself later (Codex P1).
    if (!me) return { identity: { distinctId: "mcp:unknown", region }, enabled: false, forceClosed: true };
    const distinctId = me.email ?? (me.id ? `mcp:user-${me.id}` : "mcp:unknown");
    return {
      identity: {
        distinctId,
        groups: me.organization?.id ? { organization: me.organization.id } : undefined,
        region,
        // name/email so leadbay_send_feedback attributes correctly on HTTP — the
        // module-scoped `me` is never populated here (Codex P2).
        ...(me.name ? { name: me.name } : {}),
        ...(me.email ? { email: me.email } : {}),
      },
      // Known preference: honor the per-user opt-out. Absent field → enabled
      // (older backend / opt-out default). A clean read is NOT force-closed.
      enabled: me.telemetry_enabled !== false,
      forceClosed: false,
    };
  } catch (err: any) {
    // Unknown preference (ERROR) → fail closed hard, same reasoning as timeout.
    logger.warn?.(`telemetry identity resolve failed: ${err?.message ?? err}`);
    return { identity: { distinctId: "mcp:unknown", region }, enabled: false, forceClosed: true };
  }
}

// The telemetry handle to use for a request. Always the shared handle bound to
// this request's identity; the isSuppressed predicate drops analytics + error
// telemetry when the user is opted out — but keeps captureFeedback LIVE, because
// leadbay_send_feedback is an explicit user-initiated action, not passive
// telemetry (Codex P2). Web-safe: on the multi-tenant hosted server a disabled
// user's tool calls emit no analytics, per-request, without affecting others.
//
// The predicate is LIVE (read at capture time), not a fixed pre-execute
// decision: it suppresses if EITHER the initial /users/me said disabled, OR the
// client's cache now says disabled. This closes the "opt-out request tracks
// itself" gap (Codex P2) — a `leadbay_set_telemetry disable` flips the cache
// inside execute(), so server.ts's post-execute captureToolCall for THIS request
// sees the fresh disabled state and is suppressed.
// Shared suppression precedence for the LIVE opt-out predicate (Codex P1/P2).
// Ordering matters and is the same on both transports:
//   1. `forceClosed` (an error/unknown-preference fail-closed signal) ALWAYS
//      wins — even over a cached `true` left over from session open. Otherwise
//      a cross-session opt-out whose refresh FAILS would keep emitting because
//      the stale cached `true` masked the fail-closed flag.
//   2. Otherwise the client cache decides when DEFINED — it holds the freshest
//      per-request/session value, including a synchronous stamp from
//      leadbay_set_telemetry inside execute(). `false` → suppress, `true` →
//      emit (this is what makes a same-request/session opt-IN take effect).
//   3. Cache undefined (no toggle stamped AND /users/me carried no
//      telemetry_enabled field to populate it) → defer to `fallbackEnabled`,
//      the caller's resolve verdict. That verdict already encodes the
//      older-backend default (absent field → enabled) and the fail-closed cases
//      (timeout/error → disabled), so an absent-field read still EMITS while an
//      unreadable one suppresses.
export function suppressTelemetry(
  cached: boolean | undefined,
  forceClosed: boolean,
  fallbackEnabled: boolean
): boolean {
  if (forceClosed) return true;
  if (cached !== undefined) return cached === false;
  return !fallbackEnabled;
}

export async function telemetryHandleForRequest(client: LeadbayClient): Promise<TelemetryHandle> {
  const { identity, enabled, forceClosed } = await resolveTelemetryContext(client);
  // Streamable path re-resolves per request. `enabled` is the fallback used when
  // the cache is undefined (absent-field read → enabled). `forceClosed` is set
  // when the resolve TIMED OUT or ERRORED: the losing resolveMe() may later
  // populate the cache with a `true`, and forceClosed overrides that so a
  // request the timeout failed closed cannot reopen itself (Codex P1). A clean
  // read is not force-closed, so a mid-request opt-IN stamp (cache=true) still
  // takes effect and a mid-request opt-OUT stamp (cache=false) suppresses.
  const isSuppressed = () => suppressTelemetry(client.cachedTelemetryEnabled(), forceClosed, enabled);
  return bindTelemetryIdentity(telemetry, identity, isSuppressed);
}

// Wrap the shared handle so every capture in THIS request/session carries the
// caller's identity (the server.ts capture sites don't know the identity — the
// wrapper injects it). identify()/shutdown() are inert: a closing request or an
// evicted SSE session must NEVER shut down the shared process-level client.
//
// EVERY capture method server.ts can fire per request must forward the
// request's identity — not just the tool-call ones. The PostHog methods
// (friction, agent-memory, …) otherwise emit() on the shared handle whose `me`
// is never populated on HTTP, so they'd buffer until shutdown and flush
// anonymous. captureFeedback must forward it too: it fills the Sentry feedback
// name/email from identity (Codex P2 — hosted feedback was landing anonymous).
//
// `isSuppressed` is an OPTIONAL live opt-out predicate, consulted synchronously
// on every capture. It exists for long-lived SSE sessions (product#3879): the
// server + bound handle are built ONCE at GET /sse, but a user can call
// leadbay_set_telemetry with disable mid-session — so a fixed NOOP-vs-real
// decision at connect would keep emitting until reconnect. Backed by the
// session client's cached telemetry_enabled (refreshed in POST /messages after
// the tool's invalidateMe()), the predicate flips the same session live. Omitted
// on the streamable path (each request re-resolves), where the decision is fixed.
//
// captureException is gated by isSuppressed TOO: server.ts fires it on tool
// errors (Sentry), so an opted-out user would otherwise still leak Sentry error
// telemetry (Codex P1). When NOT suppressed it passes through to base unchanged
// (its ctx already carries region/org). captureFeedback is the ONE method left
// live even when suppressed — see below.
export function bindTelemetryIdentity(
  base: TelemetryHandle,
  identity: CaptureIdentity,
  isSuppressed?: () => boolean
): TelemetryHandle {
  const on = <A extends unknown[]>(fn: (...a: A) => void) =>
    (...a: A) => {
      if (isSuppressed?.()) return;
      fn(...a);
    };
  return {
    ...base,
    captureToolCall: on((p) => base.captureToolCall(p, identity)),
    captureCompositeCall: on((p) => base.captureCompositeCall(p, identity)),
    captureQuotaHit: on((p) => base.captureQuotaHit(p, identity)),
    captureTopupLink: on((p) => base.captureTopupLink(p, identity)),
    captureStartup: on((p) => base.captureStartup(p, identity)),
    captureAgentMemoryCaptured: on((p) => base.captureAgentMemoryCaptured(p, identity)),
    captureAgentMemoryRecalled: on((p) => base.captureAgentMemoryRecalled(p, identity)),
    captureAgentMemoryPruned: on((p) => base.captureAgentMemoryPruned(p, identity)),
    captureFrictionReported: on((p) => base.captureFrictionReported(p, identity)),
    captureException: on((err, ctx) => base.captureException(err, ctx)),
    // captureFeedback is NOT gated by isSuppressed (Codex P2): leadbay_send_feedback
    // is an explicit user-initiated "deliver my message to the team" action, not
    // passive telemetry. Opting out of analytics must not silently drop the user's
    // own feedback (it would return sent:false). Identity still rides along so the
    // Sentry feedback is attributed.
    captureFeedback: (message, opts) => base.captureFeedback(message, opts, identity),
    identify: async () => {},
    shutdown: async () => {},
  };
}

// In-memory session map for the legacy SSE transport. Streamable HTTP keeps
// its own session table inside the transport instance, so we only need to
// track SSE sessions ourselves (the POST /messages endpoint needs to route
// the body to the right transport by sessionId).
interface SseSession {
  transport: SSEServerTransport;
  server: Server;
  createdAt: number;
  client: LeadbayClient;
  // Live opt-out for this session (product#3879). The bound telemetry handle
  // reads this (via suppressTelemetry) on every capture. Same-session toggles
  // are caught via the client cache the tool stamps (which wins when defined);
  // POST /messages ALSO kicks a fire-and-forget refresh to catch cross-session
  // changes, updating `suppressed` out-of-band (never blocking dispatch).
  suppressed: boolean;
  // Hard fail-closed signal: set when a cross-session refresh ERRORS (we could
  // not read the preference). This overrides even a stale cached `true` from
  // session open, so an unreadable opt-out never keeps emitting (Codex P1).
  // Cleared on the next SUCCESSFUL refresh.
  forceClosed: boolean;
  // Guards the fire-and-forget cross-session refresh so slow /users/me reads
  // don't stack up orphaned across messages and starve the session client's
  // API-semaphore slots ahead of tool work (Codex P2).
  refreshing?: boolean;
  // Monotonic epoch bumped each time a refresh STARTS. A refresh that times out
  // releases the guard so the next message can retry; if the original (now
  // orphaned) resolveMe later completes, its epoch no longer matches and its
  // result is IGNORED — otherwise a late success would clear the forceClosed we
  // set on timeout and reopen the session (Codex P1).
  refreshEpoch: number;
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
function buildServerFromClient(
  client: LeadbayClient,
  requestTelemetry: TelemetryHandle
): Server {
  const includeWrite = parseWriteEnv();
  const includeAdvanced = process.env.LEADBAY_MCP_ADVANCED === "1";
  return buildServer(client, {
    version: VERSION,
    includeWrite,
    includeAdvanced,
    logger,
    telemetry: requestTelemetry,
  });
}

// ── OAuth resource-server discovery (MCP authorization spec / RFC 9728) ──────
//
// OAuth discovery runs before we know who the user is, and Leadbay OAuth is
// single-region (a token is issued by, and valid for, one regional backend).
// So the region is encoded in the connector URL the user pastes: a US user adds
// /mcp, a FR user adds /fr/mcp. The path only selects which authorization server
// the sign-in prompt points at; tool requests auto-probe both regions, so a
// valid token routes correctly regardless.

const PRM_PREFIX = "/.well-known/oauth-protected-resource";
const RESOURCE_PATHS = ["/mcp", "/fr/mcp", "/sse", "/fr/sse"] as const;

function regionForResourcePath(resourcePath: string): "us" | "fr" {
  return /^\/fr(\/|$)/.test(resourcePath) ? "fr" : "us";
}

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
      region: regionForResourcePath(resourcePath),
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
app.use("/fr/mcp", MCP_BODY_LIMIT);
app.use("/messages", MCP_BODY_LIMIT);

// Streamable HTTP transport. Stateless mode (no sessionIdGenerator) is the
// simplest fit for ChatGPT custom connectors today — each request is its own
// MCP session. If we need long-lived state we can flip to stateful later by
// passing `sessionIdGenerator: randomUUID`.
async function handleStreamable(
  c: Context,
  resourcePath: "/mcp" | "/fr/mcp"
): Promise<Response> {
  const foreign = rejectForeignOrigin(c);
  if (foreign) return foreign;

  const token = extractBearer(c.req.header("authorization"));

  // Auto-probe (no region pin) so a missing OR invalid/expired token both yield
  // a 401 challenge, and a valid token routes to whichever region owns it.
  const resolved = await resolveClientFromToken(token, { logger });
  if (resolved.authState === "missing" || resolved.authState === "expired") {
    return sendChallenge(c, resourcePath, resolved.authState);
  }

  // Resolve identity for THIS request and bind it onto the shared telemetry
  // handle so every tool-call event carries the caller's distinctId (without
  // this the hosted server emitted nothing — product#3876). If the user has
  // opted out (telemetry_enabled=false), this returns NOOP so a disabled user's
  // events are suppressed per-request — product#3879.
  const server = buildServerFromClient(
    resolved.client,
    await telemetryHandleForRequest(resolved.client)
  );
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
app.all("/fr/mcp", (c) => handleStreamable(c, "/fr/mcp"));

// Legacy SSE transport. Two endpoints: GET /sse opens the stream, POST
// /messages?sessionId=... feeds JSON-RPC messages in.
async function handleSse(c: Context, resourcePath: "/sse" | "/fr/sse"): Promise<Response> {
  const foreign = rejectForeignOrigin(c);
  if (foreign) return foreign;

  const token = extractBearer(c.req.header("authorization"));

  const resolved = await resolveClientFromToken(token, { logger });
  if (resolved.authState === "missing" || resolved.authState === "expired") {
    return sendChallenge(c, resourcePath, resolved.authState);
  }

  // Resolve identity ONCE per SSE session for attribution, but the opt-out is
  // LIVE: the session holds a mutable `suppressed` flag the bound handle reads
  // on every capture, and POST /messages refreshes it before each dispatch. So
  // a mid-session leadbay_set_telemetry disable takes effect on the next
  // message, not only after reconnect (product#3879).
  const { identity, enabled, forceClosed } = await resolveTelemetryContext(resolved.client);
  const session: SseSession = {
    transport: undefined as unknown as SSEServerTransport, // set below
    server: undefined as unknown as Server, // set below
    createdAt: Date.now(),
    client: resolved.client,
    suppressed: !enabled,
    // Carry the resolve verdict's hard fail-closed (timeout/error at open). It
    // overrides even a cached `true` a late/orphaned resolveMe might populate,
    // and is cleared on the next SUCCESSFUL /messages refresh.
    forceClosed,
    refreshEpoch: 0,
  };
  const env = c.env as { incoming: IncomingMessage; outgoing: ServerResponse };
  const transport = new SSEServerTransport("/messages", env.outgoing);
  const server = buildServerFromClient(
    resolved.client,
    // Suppression precedence via the shared suppressTelemetry() helper (Codex
    // P1/P2): session.forceClosed (a refresh that ERRORED — unreadable
    // preference) wins even over a stale cached `true`, so an unreadable
    // cross-session opt-out never keeps emitting; otherwise the client cache
    // governs when DEFINED (a same-session `disable`→false suppresses its own
    // capture, an `enable`→true un-suppresses immediately); cache-undefined
    // falls back to session.suppressed (refreshed by POST /messages for
    // cross-session changes).
    bindTelemetryIdentity(
      telemetry,
      identity,
      () =>
        suppressTelemetry(
          resolved.client.cachedTelemetryEnabled(),
          session.forceClosed,
          !session.suppressed
        )
    )
  );
  await server.connect(transport);

  const sessionId = transport.sessionId;
  session.transport = transport;
  session.server = server;
  sseSessions.set(sessionId, session);
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
app.get("/fr/sse", (c) => handleSse(c, "/fr/sse"));

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

  // Opt-out enforcement for THIS message comes from the bound handle's live
  // predicate (suppressTelemetry over the client cache + session flags), NOT
  // from a blocking pre-dispatch fetch. A same-session leadbay_set_telemetry
  // toggle stamps the client cache inside execute(), so the predicate already
  // catches it without any refresh here.
  //
  // The ONLY thing a refresh adds is catching a toggle made from ANOTHER
  // connector/session. So we kick it off FIRE-AND-FORGET (never awaited) and
  // never block dispatch on it (Codex P2): a slow /users/me must not occupy the
  // session client's API-semaphore slots ahead of the actual tool work.
  //
  // We run the refresh for EVERY message, including leadbay_set_telemetry ones
  // (Codex P2): the client's telemetry state-sequence guard + dedicated durable
  // preference field mean a concurrent read can no longer clobber the tool's
  // stamp, so there's nothing to protect by skipping — and skipping by-name
  // previously let a stale-enabled session skip the re-read on a BAD_ACTION call
  // that never did its own read. Reading the preference back via
  // cachedTelemetryEnabled() (the guarded, invalidateMe-surviving field), NOT
  // the raw resolveMe payload, keeps a mid-flight toggle authoritative.
  //
  // BOUNDED (Codex P1): resolveMe has no timeout/abort, so a hung /users/me must
  // not wedge session.refreshing forever (which would make every later message
  // skip the refresh until reconnect/TTL). We race it against a timeout that
  // fails closed and releases the guard so a subsequent message can retry. A
  // per-refresh epoch (retired the instant EITHER branch of the race settles)
  // guarantees only the first settle mutates session state — so a slow read that
  // finishes AFTER its own timeout is discarded and cannot reopen the
  // fail-closed verdict (Codex P1). The orphaned read still finishes in the
  // background but the client's read-sequence guard stops it mutating the cache.
  if (!session.refreshing) {
    session.refreshing = true;
    const epoch = ++session.refreshEpoch; // this refresh's identity
    // Only THIS refresh's completion may mutate session state — and only while
    // it is still the current epoch. Both the timeout branch and any later
    // refresh bump refreshEpoch, so an abandoned read that resolves afterward is
    // discarded (Codex P1). `settle()` also releases the guard exactly once, and
    // never re-opens the guard for a stale winner.
    const settle = (apply: () => void) => {
      if (session.refreshEpoch !== epoch) return;
      session.refreshEpoch++; // retire this epoch so nothing else mutates for it
      apply();
      session.refreshing = false;
    };
    void Promise.race([
      session.client.resolveMe(true).then(
        () => () => {
          session.suppressed = session.client.cachedTelemetryEnabled() === false;
          session.forceClosed = false; // read succeeded — clear any hard fail-closed
        },
        () => () => {
          // Unreadable preference → fail closed HARD, overriding a stale cached
          // `true` from session open (Codex P1).
          session.suppressed = true;
          session.forceClosed = true;
        }
      ),
      new Promise<() => void>((resolve) =>
        setTimeout(
          () =>
            resolve(() => {
              // Timed out — fail closed HARD and let the next message retry. The
              // retired epoch + client's read-sequence guard mean the orphaned
              // resolveMe cannot later clear this forceClosed or clobber the cache.
              session.suppressed = true;
              session.forceClosed = true;
            }),
          IDENTITY_RESOLVE_TIMEOUT_MS
        )
      ),
    ]).then(settle);
  }
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
    // Process-level boot signal (no per-user identity — no request yet). Lets us
    // correlate "events stopped" in PostHog with a Fly restart/redeploy. Pass an
    // explicit process-level identity: the shared handle never calls identify()
    // in the HTTP process, so without an override this would buffer in
    // pendingEvents and only surface at shutdown (or be lost on a crash).
    telemetry.captureStartup(
      { auth_state: "ok", region: "unknown" },
      { distinctId: "mcp:http-server", region: "unknown" }
    );
  });

  // Flush the shared PostHog client on Fly's SIGTERM (sent on every redeploy)
  // and on SIGINT — without this the last unflushed batch (up to flushInterval /
  // flushAt) is lost on each deploy.
  const gracefulShutdown = async () => {
    try {
      await telemetry.shutdown();
    } finally {
      process.exit(0);
    }
  };
  process.once("SIGTERM", () => void gracefulShutdown());
  process.once("SIGINT", () => void gracefulShutdown());
}
