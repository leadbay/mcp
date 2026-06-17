// Per-request auth resolver for the hosted HTTP MCP server.
//
// Stdio MCP gets its token from LEADBAY_TOKEN at process boot. The hosted
// HTTP server is multi-tenant and reads a fresh bearer token from each request
// Authorization header. Shared auth-failure helpers live in broken-client.ts so
// this file never imports the CLI entrypoint.


import { createClient, REGIONS, type LeadbayClient, type LeadbayError, type ToolLogger } from "@leadbay/core";
import { makeBrokenClient, type ResolvedClient } from "./broken-client.js";

export interface ResolveTokenOptions {
  // Optional region pin. Provided by the HTTP transport from a header
  // (`X-Leadbay-Region: us|fr`) or query param. When omitted, we probe both
  // backends in parallel — same trade-off as the stdio env path.
  region?: "us" | "fr";
  // Optional baseUrl override. Mirrors $LEADBAY_BASE_URL in stdio.
  baseUrl?: string;
  logger?: ToolLogger;
}

export async function resolveClientFromToken(
  token: string | undefined,
  opts: ResolveTokenOptions = {}
): Promise<ResolvedClient> {
  const { region, baseUrl, logger } = opts;

  if (!token || token.length === 0) {
    // Same broken-client pattern as stdio: let the JSON-RPC handshake
    // complete so the first tool call surfaces AUTH_MISSING in a render-able
    // envelope, instead of dying mid-`initialize` and showing the user a
    // bare "Server disconnected".
    const fallbackRegion: "us" | "fr" = region === "fr" ? "fr" : "us";
    return {
      client: makeBrokenClient(
        {
          error: true,
          code: "AUTH_MISSING",
          message: "Missing bearer token on hosted MCP request.",
          hint: "Pass a Leadbay OAuth bearer token in the Authorization header: `Authorization: Bearer <token>`. Authenticate locally with `npx -y @leadbay/mcp login --oauth`.",
        },
        fallbackRegion
      ),
      authState: "missing",
    };
  }

  // If the caller pinned baseUrl or region, honor it exactly.
  if (baseUrl || region) {
    const config: { token: string; baseUrl?: string; region?: "us" | "fr" } = { token };
    if (baseUrl) config.baseUrl = baseUrl;
    if (region) config.region = region;
    return { client: createClient(config), authState: "ok" };
  }

  // Auto-probe path: token is sent to BOTH api-us and api-fr. Hosted callers
  // should set the region header to avoid this; the warning here goes to
  // server logs (the user can't see stderr on a hosted endpoint).
  logger?.info?.("hosted MCP: region unpinned, probing api-us + api-fr in parallel");

  const probe = async (r: "us" | "fr"): Promise<LeadbayClient> => {
    const c = createClient({ token, region: r });
    await c.request("GET", "/users/me");
    return c;
  };

  try {
    const client = await Promise.any([probe("us"), probe("fr")]);
    return { client, authState: "ok" };
  } catch (err: any) {
    const errors: any[] = err?.errors ?? [];
    const firstAuth = errors.find(
      (e) => e?.code === "AUTH_EXPIRED" || e?.code === "NOT_AUTHENTICATED"
    );
    if (firstAuth) {
      return {
        client: makeBrokenClient(
          {
            error: true,
            code: firstAuth.code,
            message: firstAuth.message,
            hint: "Verify the bearer token is valid. Pin the region with an `X-Leadbay-Region: us|fr` header to skip auto-probing. Authenticate again with `npx -y @leadbay/mcp login --oauth`.",
          } satisfies LeadbayError,
          "us"
        ),
        authState: "expired",
      };
    }
    // Non-auth failure (network, DNS) — fall back to us so the server can
    // still answer tool calls with an error envelope rather than dying.
    return {
      client: createClient({ token, region: "us" }),
      authState: "probe_failed",
    };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// OAuth resource-server discovery (MCP authorization spec / RFC 9728)
//
// The hosted MCP endpoint is an OAuth 2.0 *protected resource*. A spec-compliant
// remote client (Claude Desktop, ChatGPT) only runs its sign-in flow when the
// server (a) returns 401 + a `WWW-Authenticate` header pointing at protected
// resource metadata and (b) serves that metadata advertising the authorization
// server. Without it the client never prompts — the reported bug. The Leadbay
// regional backends already act as the OAuth authorization server (they serve
// /.well-known/oauth-authorization-server + register/authorize/token); we just
// point the client at the right one.

/** Region → OAuth authorization server (the regional backend that serves the
 *  authorization-server metadata, registration, and token endpoints). */
export function regionAuthServer(region: "us" | "fr"): string {
  return region === "fr" ? REGIONS.fr : REGIONS.us;
}

export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  bearer_methods_supported: string[];
}

/** RFC 9728 Protected Resource Metadata for a hosted MCP endpoint. `resourceUrl`
 *  is the canonical endpoint the client connected to (e.g.
 *  https://leadbay-mcp-prod.fly.dev/mcp). */
export function protectedResourceMetadata(opts: {
  resourceUrl: string;
  region: "us" | "fr";
}): ProtectedResourceMetadata {
  return {
    resource: opts.resourceUrl,
    authorization_servers: [regionAuthServer(opts.region)],
    bearer_methods_supported: ["header"],
  };
}

/** RFC 6750 §3 `WWW-Authenticate` value that points the client at our protected
 *  resource metadata so it can discover the Leadbay OAuth server and sign in.
 *  Per §3.1 we omit the error code when no credentials were sent (`missing`) and
 *  include `invalid_token` when a token was sent but rejected (`expired`). */
export function buildWwwAuthenticate(opts: {
  resourceMetadataUrl: string;
  authState: "missing" | "expired";
}): string {
  const parts = ['Bearer realm="mcp"'];
  if (opts.authState === "expired") {
    parts.push('error="invalid_token"');
    parts.push('error_description="The access token is invalid or has expired"');
  }
  parts.push(`resource_metadata="${opts.resourceMetadataUrl}"`);
  return parts.join(", ");
}
