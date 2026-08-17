// Per-request auth resolver for the hosted HTTP MCP server.
//
// Stdio MCP gets its token from LEADBAY_TOKEN at process boot. The hosted
// HTTP server is multi-tenant and reads a fresh bearer token from each request
// Authorization header. Shared auth-failure helpers live in broken-client.ts so
// this file never imports the CLI entrypoint.


import { createClient, type LeadbayError, type ToolLogger, type UserMePayload } from "@leadbay/core";
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
  // Per-probe deadline in ms. Defaults to PROBE_TIMEOUT_MS; exposed so tests can
  // drive the stalled-region path without waiting seconds.
  probeTimeoutMs?: number;
}

/**
 * Wall-clock budget for ONE region's `/users/me` validation probe.
 *
 * The probes run one after another (the outcome of the first decides whether the
 * second is even meaningful), so without a deadline a single stalled region
 * would hold the whole request open: node:https has no default socket timeout,
 * and a backend that accepts the connection then goes silent never rejects. That
 * would strand a caller whose token the SIBLING region would have accepted.
 * A probe that overruns is treated exactly like a 5xx — a transient fault — so
 * the resolver moves to the next candidate instead of forcing re-auth. Worst
 * case for a request is therefore two deadlines (both regions dark), which is
 * bounded — the previous behaviour was not bounded at all.
 */
export const PROBE_TIMEOUT_MS = 4000;

/**
 * Decode the region from a Stargate-issued access token's trailing suffix:
 * `o.<token>_fr` / `o.<token>_us` → "fr" / "us". Returns undefined for an
 * untagged/legacy token (caller falls back). The token body isn't otherwise
 * inspected here — the backend validates it.
 *
 * The suffix is a routing HINT, not proof of provenance: a legacy opaque bearer
 * can end in `_fr` by coincidence and it would be indistinguishable from a
 * tagged one. So callers must not treat a match as a hard region pin — see the
 * candidate list in resolveClientFromToken, which still probes the sibling
 * region before declaring such a token expired.
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
  const {
    region,
    preferRegion,
    baseUrl,
    logger,
    validate = true,
    probeTimeoutMs = PROBE_TIMEOUT_MS,
  } = opts;

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
  // and be falsely reported expired. So the suffix (else `preferRegion`, else US)
  // decides which region is tried FIRST and which one the client binds to; it
  // never decides that the sibling goes untried.
  const suffixRegion = regionFromToken(token);
  // Untagged token: probe `preferRegion` first (e.g. "fr" from the /fr/mcp alias),
  // else default US-first. Suffixed token: the suffix is authoritative.
  const primaryRegion: "us" | "fr" = suffixRegion ?? preferRegion ?? "us";

  if (!validate) {
    return { client: createClient({ token, region: primaryRegion }), authState: "ok" };
  }

  // Probe candidates: the primary region first, then the sibling. A candidate's
  // outcome is one of: OK (return immediately), auth-reject (try the next), or
  // non-auth fault (try the next — it might be a transient/backend error while
  // the token is valid elsewhere).
  //
  // The sibling is a candidate even for a SUFFIXED token, because the suffix is
  // only a hint: a legacy opaque bearer whose value happens to end in `_us`/`_fr`
  // is byte-for-byte indistinguishable from a Stargate-tagged one. Probing only
  // the named region would report such a token `expired` on its single 401 and
  // push a user with a perfectly valid sibling-region token through reauth, over
  // and over, until their token is rotated. The extra probe costs one round trip
  // and ONLY on the failure path — a token the named region accepts still
  // resolves on the first probe, which is the whole point of the suffix.
  const candidates: ("us" | "fr")[] =
    primaryRegion === "us" ? ["us", "fr"] : ["fr", "us"];

  let sawAuthReject = false;
  // Whether the PRIMARY (owning) region specifically auth-rejected. Distinct
  // from sawAuthReject: the retry below is only meaningful for the region the
  // token claims to belong to, and gating it on "no sibling faulted" was too
  // narrow (see the mixed-outcome note there).
  let primaryAuthRejected = false;
  // The first rejection, kept so the expired envelope carries the backend's own
  // code and message rather than a generic stand-in.
  let firstAuthError: LeadbayError | undefined;
  // The region whose probe hit a transient (non-auth) fault, if any. When we
  // suppress re-auth below we bind the client HERE, not to primaryRegion: the
  // token is plausibly valid in this region (the fault was transient), whereas
  // primaryRegion may be a region that already AUTH-REJECTED the token — sending
  // the next tool call there would fail auth needlessly.
  let nonAuthFaultRegion: "us" | "fr" | undefined;
  for (const r of candidates) {
    const client = createClient({ token, region: r });
    try {
      // Fail-fast validation: retryOn401:false. We must NOT retry a 401 here — the
      // auto-retry would mask an auth rejection and prevent the dual-region fallback
      // (a legacy FR token 401'ing on US must move to FR, not retry US and bind there).
      // Cache-warming for telemetry is handled after success via seedMe(), so this
      // still avoids the second /users/me round trip resolveIdentity would otherwise do.
      // The deadline is what keeps the candidates independent: probes run in
      // sequence, so an unbounded first probe against a stalled region would
      // starve the sibling that could still accept this token.
      const me = await client.request<UserMePayload>(
        "GET",
        "/users/me",
        undefined,
        { retryOn401: false, timeoutMs: probeTimeoutMs }
      );
      client.seedMe(me); // warm the /users/me cache so resolveIdentity reuses it
      return { client, authState: "ok" };
    } catch (e) {
      const code = (e as LeadbayError)?.code;
      if (code === "AUTH_EXPIRED" || code === "NOT_AUTHENTICATED") {
        sawAuthReject = true;
        if (r === primaryRegion) primaryAuthRejected = true;
        firstAuthError ??= e as LeadbayError;
      } else {
        if (code === "TIMEOUT") {
          logger?.warn?.(
            `hosted MCP auth probe against ${r} exceeded ${probeTimeoutMs}ms — moving on to the next candidate region`
          );
        }
        // Non-auth fault (5xx / network / timeout) on THIS region — do NOT bind here yet. The
        // token may be valid in the sibling region (e.g. US 503 while FR is healthy
        // on the shared /mcp URL), so keep probing the remaining candidates. Record
        // the first such region so we can bind to it if nothing resolves cleanly.
        nonAuthFaultRegion ??= r;
      }
      continue;
    }
  }

  // Last chance before we force a re-auth: retry the PRIMARY region once.
  //
  // The probes above deliberately run with retryOn401:false so an auth rejection
  // can't be masked and the dual-region fallback still happens. But a Leadbay 401
  // is usually NOT expiry — LeadbayClient's own retry exists because "tokens don't
  // expire, so a 401 is almost always a transient server-side blip" (client.ts
  // httpsRequestWithRetry). Without this step a blip on the owning region cascades:
  // the sibling 401s too (the token is region-scoped), both rejections look
  // authoritative, and a perfectly valid token gets an invalid_token challenge —
  // a regression against the previous resolveMe() probe, which inherited the
  // client's one-retry policy.
  //
  // Placed AFTER the loop rather than inside it on purpose: retrying mid-loop
  // would delay the sibling probe (which the sequential-probe deadline exists to
  // protect) and would spend the extra round trip on the legacy-token path, where
  // the 401 is expected and the sibling is the answer. Here it costs one request
  // only on the path that was about to force re-auth, which is far more expensive
  // for the user.
  //
  // Two conditions, and both matter:
  //
  //  - the PRIMARY specifically auth-rejected — not merely "some candidate did";
  //  - the token is SUFFIXED, so `primaryRegion` is the region the token actually
  //    CLAIMS rather than a guess.
  //
  // Note it is deliberately NOT gated on "no sibling faulted". That was the
  // mixed-outcome bug: owning region blips 401 while the sibling times out or
  // 5xxs, `nonAuthFaultRegion` gets set, the retry is skipped, and we bind to the
  // FAULTING SIBLING — the wrong backend for a region-scoped token, so the
  // request proceeds with no challenge and every later tool call 401s against a
  // region the token was never scoped to. A recovered retry is positive evidence
  // that this region does accept the token, so it outranks that fallback.
  //
  // The suffix condition is what keeps the UNTAGGED contract intact: with no
  // suffix, `primaryRegion` is just preferRegion-or-US, so a 401 there is not a
  // blip on the owning backend and the sibling really is the better candidate
  // (see the "bind to the transient region, not the rejecting one" cases).
  if (primaryAuthRejected && suffixRegion !== undefined) {
    const client = createClient({ token, region: primaryRegion });
    try {
      const me = await client.request<UserMePayload>(
        "GET",
        "/users/me",
        undefined,
        { retryOn401: true, timeoutMs: probeTimeoutMs }
      );
      logger?.warn?.(
        `hosted MCP auth probe against ${primaryRegion} recovered on retry — the first 401 was a transient blip, not an expired token`
      );
      client.seedMe(me);
      return { client, authState: "ok" };
    } catch (e) {
      const code = (e as LeadbayError)?.code;
      if (code !== "AUTH_EXPIRED" && code !== "NOT_AUTHENTICATED") {
        // The retry hit a transient fault instead. Same reasoning as in the loop:
        // we can no longer be sure the token is bad, so don't force re-auth.
        //
        // Overwrites a sibling's recorded fault on purpose. Both regions are now
        // unproven, and the primary is the one the token CLAIMS (its suffix, or
        // the caller's preferRegion) — so it is the better region to bind to than
        // a sibling that merely happened to fault first.
        nonAuthFaultRegion = primaryRegion;
      } else {
        firstAuthError ??= e as LeadbayError;
      }
    }
  }

  // No candidate returned OK. If ANY candidate rejected on auth grounds AND none
  // hit a transient fault that could be masking a valid token, treat as genuinely
  // expired → invalid_token challenge (host silently refreshes).
  if (sawAuthReject && nonAuthFaultRegion === undefined) {
    logger?.warn?.("hosted MCP bearer rejected by all candidate regions — emitting invalid_token challenge");
    // A broken client, not a live one holding a bearer every region just
    // rejected. Both hosted call sites answer the 401 challenge without ever
    // touching it, and the stdio resolver does the same (bin.ts), so this only
    // matters for a caller that forgets to check authState — and that caller
    // should get a render-able AUTH_EXPIRED envelope, not a request fired with a
    // known-bad token.
    return {
      client: makeBrokenClient(
        {
          error: true,
          code: firstAuthError?.code ?? "AUTH_EXPIRED",
          message: firstAuthError?.message ?? "The Leadbay access token was rejected.",
          hint: "The token is invalid or expired. The 401 challenge carries `error=\"invalid_token\"` so a spec-compliant host refreshes silently; otherwise authenticate again with `npx -y @leadbay/mcp login --oauth`.",
        },
        primaryRegion
      ),
      authState: "expired",
    };
  }
  // A non-auth fault occurred, so we can't be sure the token is invalid → proceed
  // as ok (don't force spurious re-auth); a real fault re-surfaces on the tool call.
  // Bind to the region that had the TRANSIENT fault (where the token is plausibly
  // valid), NOT primaryRegion — which may be a region that already auth-rejected it.
  const bindRegion = nonAuthFaultRegion ?? primaryRegion;
  return { client: createClient({ token, region: bindRegion }), authState: "ok" };
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
