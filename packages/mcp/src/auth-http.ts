// Per-request auth resolver for the hosted HTTP MCP server.
//
// Stdio MCP gets its token from LEADBAY_TOKEN at process boot. The hosted
// HTTP server is multi-tenant and reads a fresh bearer token from each request
// Authorization header. Shared auth-failure helpers live in broken-client.ts so
// this file never imports the CLI entrypoint.


import { createClient, REGIONS, type LeadbayClient, type LeadbayError, type ToolLogger } from "@leadbay/core";
import { makeBrokenClient, type ResolvedClient } from "./broken-client.js";

export interface ResolveTokenOptions {
  // Optional region pin. Normally unused — the region is decoded from the token's
  // `_us`/`_fr` suffix (Stargate-centered flow). An explicit pin still wins.
  region?: "us" | "fr";
  // Optional baseUrl override. Mirrors $LEADBAY_BASE_URL in stdio.
  baseUrl?: string;
  logger?: ToolLogger;
}

/**
 * Decode the region from a Stargate-issued access token's trailing suffix:
 * `o.<token>_fr` / `o.<token>_us` → "fr" / "us". Returns undefined for an
 * untagged/legacy token (caller falls back). The token body isn't otherwise
 * inspected here — the backend validates it.
 */
export function regionFromToken(token: string): "us" | "fr" | undefined {
  const i = token.lastIndexOf("_");
  if (i < 0) return undefined;
  const tag = token.slice(i + 1).toLowerCase();
  return tag === "us" || tag === "fr" ? tag : undefined;
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

  // Stargate-issued tokens carry a `_us`/`_fr` region suffix, so we route directly
  // to the owning backend — no dual-region auto-probe. An untagged/legacy token
  // (no known suffix) falls back to us; the backend returns an auth error envelope
  // if it doesn't own the token.
  const tokenRegion = regionFromToken(token) ?? "us";
  return { client: createClient({ token, region: tokenRegion }), authState: "ok" };
}

// ────────────────────────────────────────────────────────────────────────────
// OAuth resource-server discovery (MCP authorization spec / RFC 9728)
//
// The hosted MCP endpoint is an OAuth 2.0 *protected resource*. A spec-compliant
// remote client (Claude Desktop, ChatGPT) only runs its sign-in flow when the
// server (a) returns 401 + a `WWW-Authenticate` header pointing at protected
// resource metadata and (b) serves that metadata advertising the authorization
// server. Without it the client never prompts.
//
// Stargate is the single, region-agnostic OAuth authority (it fronts both
// regional backends and routes by the token/code region suffix). So discovery
// advertises ONE authorization server for everyone — the shared connector URL
// works regardless of the user's region, and the region rides in the token
// suffix, not the connector path.

/** The single OAuth authorization server (Stargate). Overridable for staging/tests. */
export const STARGATE_AUTH_SERVER =
  process.env.LEADBAY_AUTH_SERVER ?? "https://auth.leadbay.app";

export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  bearer_methods_supported: string[];
}

/** RFC 9728 Protected Resource Metadata for a hosted MCP endpoint. `resourceUrl`
 *  is the canonical endpoint the client connected to (e.g.
 *  https://mcp.leadbay.app/mcp). Advertises the single Stargate auth server. */
export function protectedResourceMetadata(opts: {
  resourceUrl: string;
}): ProtectedResourceMetadata {
  return {
    resource: opts.resourceUrl,
    authorization_servers: [STARGATE_AUTH_SERVER],
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
