// Per-request auth resolver for the hosted HTTP MCP server.
//
// Stdio MCP gets its token from LEADBAY_TOKEN at process boot. The hosted
// HTTP server is multi-tenant and reads a fresh bearer token from each request
// Authorization header. Shared auth-failure helpers live in broken-client.ts so
// this file never imports the CLI entrypoint.


import { createClient, type LeadbayError, type ToolLogger } from "@leadbay/core";
import { makeBrokenClient, type ResolvedClient } from "./broken-client.js";

export interface ResolveTokenOptions {
  // Optional region pin. Normally unused — the region is decoded from the token's
  // `_us`/`_fr` suffix (Stargate-centered flow). An explicit pin still wins and
  // SKIPS validation (no probe).
  region?: "us" | "fr";
  // Preferred region for the validation probe of an UNTAGGED (legacy, no-suffix)
  // token: probe this region first, then fall back to the sibling. Unlike `region`
  // it does NOT skip validation and does NOT pin — a valid token in EITHER region
  // still resolves. The hosted `/fr/mcp` compat alias sets this to "fr" so legacy
  // EU tokens probe FR first. Ignored for suffixed tokens (the suffix decides).
  preferRegion?: "us" | "fr";
  // Optional baseUrl override. Mirrors $LEADBAY_BASE_URL in stdio.
  baseUrl?: string;
  logger?: ToolLogger;
  // When true (the default for the hosted HTTP path), validate the bearer with a
  // single lightweight `/users/me` probe against the region the suffix names, so
  // an expired/revoked token yields authState:"expired" and the caller can emit
  // the RFC 6750 `invalid_token` challenge that drives the host's silent refresh.
  // Set false to skip the round-trip (e.g. an explicit region/baseUrl pin where
  // the caller doesn't need the refresh signal).
  validate?: boolean;
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
  const { region, preferRegion, baseUrl, logger, validate = true } = opts;

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
  // to the owning backend. A legacy/untagged token has NO suffix — we must not pin
  // it to one region, or an existing FR token validated only against US would 401
  // and be falsely reported expired. So:
  //   - suffixed token  → probe the one region the suffix names.
  //   - untagged token  → probe the preferred region (a `_fr` path hint via `opts`
  //                       can't reach here since it early-returns above, so the
  //                       preference is US-first), then FALL BACK to the other
  //                       region; only expired if BOTH reject.
  const suffixRegion = regionFromToken(token);
  // Untagged token: probe `preferRegion` first (e.g. "fr" from the /fr/mcp alias),
  // else default US-first. Suffixed token: the suffix is authoritative.
  const primaryRegion: "us" | "fr" = suffixRegion ?? preferRegion ?? "us";

  if (!validate) {
    return { client: createClient({ token, region: primaryRegion }), authState: "ok" };
  }

  // Probe candidates: a suffixed token names exactly one region; an untagged token
  // tries both (primary first, then the sibling) so a valid legacy token in EITHER
  // region resolves. A candidate's outcome is one of: OK (return immediately),
  // auth-reject (try the next), or non-auth fault (try the next — it might be a
  // transient/backend error while the token is valid elsewhere).
  const candidates: ("us" | "fr")[] = suffixRegion
    ? [suffixRegion]
    : primaryRegion === "us"
      ? ["us", "fr"]
      : ["fr", "us"];

  let sawAuthReject = false;
  let sawNonAuthFault = false;
  for (const r of candidates) {
    const client = createClient({ token, region: r });
    try {
      // retryOn401:false so a bad token fails fast rather than double-probing.
      await client.request("GET", "/users/me", undefined, { retryOn401: false });
      return { client, authState: "ok" };
    } catch (e) {
      const code = (e as LeadbayError)?.code;
      if (code === "AUTH_EXPIRED" || code === "NOT_AUTHENTICATED") {
        sawAuthReject = true;
      } else {
        // Non-auth fault (5xx / network) on THIS region — do NOT bind here yet. The
        // token may be valid in the sibling region (e.g. US 503 while FR is healthy
        // on the shared /mcp URL), so keep probing the remaining candidates.
        sawNonAuthFault = true;
      }
      continue;
    }
  }

  // No candidate returned OK. If ANY candidate rejected on auth grounds AND none
  // hit a transient fault that could be masking a valid token, treat as genuinely
  // expired → invalid_token challenge (host silently refreshes). But if a non-auth
  // fault occurred on any candidate, we can't be sure the token is invalid, so
  // proceed as ok (don't force spurious re-auth); a real fault re-surfaces on the
  // tool call. Bind the client to the primary region for the response.
  if (sawAuthReject && !sawNonAuthFault) {
    logger?.warn?.("hosted MCP bearer rejected by all candidate regions — emitting invalid_token challenge");
    return { client: createClient({ token, region: primaryRegion }), authState: "expired" };
  }
  return { client: createClient({ token, region: primaryRegion }), authState: "ok" };
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
