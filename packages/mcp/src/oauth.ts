/**
 * OAuth 2.0 Authorization Code + PKCE flow for the `leadbay-mcp login --oauth`
 * subcommand.
 *
 * Implements the relevant subset of RFC 6749, 7591 (Dynamic Client
 * Registration), 7636 (PKCE), and 8252 (Native Apps with loopback redirect):
 *
 *   1. GET  <authServer>/.well-known/oauth-authorization-server
 *   2. POST <registration_endpoint>                              → client_id
 *   3. Spin up an http://127.0.0.1:<random>/callback listener
 *   4. Open browser to <authorization_endpoint>?...&code_challenge=...
 *   5. Listener captures ?code=&state=, validates state
 *   6. POST <token_endpoint> with code + code_verifier            → o.<token>
 *
 * The resulting "o."-prefixed opaque token is interchangeable with the legacy
 * email-password bearer token at packages/core/src/client.ts:388 — same
 * Authorization: Bearer header, same long-lived shape. No refresh.
 */

import { createHash, randomBytes } from "node:crypto";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { request as httpsRequestRaw } from "node:https";
import { spawn } from "node:child_process";
import { AddressInfo } from "node:net";
import { readdirSync } from "node:fs";

// Stable loopback port for the OAuth callback. The Leadbay backend requires the
// authorize redirect_uri to EXACTLY match the registered one (no RFC 8252
// loopback-port matching), so for a cached client_id to keep working we must
// also reuse the same port every launch — and register that exact port. Picked
// from the IANA dynamic/private range, high enough to rarely collide; if it's
// busy we fall back to an ephemeral port + a fresh registration for that port.
const LEADBAY_LOOPBACK_PORTS = [51789, 51790, 51791, 51792];

// ────────────────────────────────────────────────────────────────────────────
// Types

export interface DiscoveryDoc {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  code_challenge_methods_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
}

export interface RegisterResponse {
  client_id: string;
  client_secret?: string;
  redirect_uris: string[];
  token_endpoint_auth_method?: string;
}

export interface PkcePair {
  verifier: string;
  challenge: string;
  method: "S256";
}

export interface OAuthLoginOptions {
  /** Base URL of the regional backend, e.g. "https://staging.api.leadbay.app". */
  authServerBaseUrl: string;
  /** Human-readable client_name for DCR — appears in the consent screen. */
  clientName: string;
  /** Optional logo URL (http/https only — backend rejects others). */
  logoUri?: string;
  /** stderr-style progress sink. Defaults to no-op. */
  log?: (msg: string) => void;
  /** Override for the browser-open step (tests). Defaults to openInBrowser(). */
  openBrowser?: (url: string) => Promise<void>;
  /** How long to wait for the user to finish the browser flow. Default: 5 min. */
  timeoutMs?: number;
  /**
   * When the browser can't be opened automatically (e.g. Claude Desktop's
   * sanitized spawn environment), don't block for the full callback timeout —
   * throw {@link BrowserOpenFailedError} carrying the authorize URL so the
   * caller can surface a clickable sign-in link immediately instead of after a
   * 5-minute hang. Default: false (legacy behaviour — keep waiting, the user
   * may open the logged URL by hand, as the CLI `login` flow expects).
   */
  failFastOnOpenError?: boolean;
  /**
   * Fires with the fully-built authorize URL the moment it's known — BEFORE
   * the (best-effort) browser open and BEFORE blocking on the callback. The
   * loopback listener is already live when this fires, so the URL is
   * immediately clickable. Used by the non-blocking .dxt bootstrap to surface
   * a live sign-in link to the user (the spawned MCP process often can't open
   * a GUI browser itself — no DISPLAY / sanitized env — so `openBrowser` can
   * silently no-op). Errors in the callback are swallowed.
   */
  onAuthorizeUrl?: (url: string) => void;
  /**
   * Return a previously-registered `client_id` to REUSE (keyed by the loopback
   * `port` it was registered for) instead of registering fresh. DCR is a
   * once-and-reuse operation; re-registering every launch is what exhausts the
   * backend's ~10-registrations/IP/hour limit (Claude Desktop probe-restarts
   * multiply each install into several launches). The port is part of the key
   * because the backend pins the exact redirect_uri (port included), so a
   * client_id is only reusable when the listener bound the same port it was
   * registered for. Return undefined to force a fresh registration.
   */
  getCachedClientId?: (port: number) => string | undefined;
  /** Persist a freshly-registered `client_id` for `port` so future launches reuse it. */
  onClientRegistered?: (clientId: string, port: number) => void;
}

/**
 * Thrown by {@link oauthLogin} when `failFastOnOpenError` is set and the
 * browser could not be launched. Carries the authorize URL so the caller can
 * present a manual sign-in link to the user.
 */
export class BrowserOpenFailedError extends Error {
  readonly authorizeUrl: string;
  constructor(authorizeUrl: string, cause: unknown) {
    super(
      `Could not open a browser automatically: ${
        (cause as any)?.message ?? cause
      }`
    );
    this.name = "BrowserOpenFailedError";
    this.authorizeUrl = authorizeUrl;
  }
}

export interface OAuthLoginResult {
  accessToken: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Region inference via stargate GeoIP
//
// OAuth has no credential-leak risk (DCR is anonymous), so we don't need the
// `--region` ceremony the password flow requires. Stargate's /user_info reads
// the caller's IP via MaxMind GeoLite2 and returns the ISO-3166 country. We
// then map country → region using the same partition the backend's /login
// route uses: France + French overseas territories → fr, US → us.
//
// If GeoIP misroutes the user (VPN, travel), --region is still available as
// an explicit override on the CLI.

const STARGATE_URLS = {
  prod: "https://stargate.leadbay.app/1.0/user_info",
  staging: "https://staging.stargate.leadbay.app/1.0/user_info",
};

const FR_COUNTRY_CODES = new Set([
  "FR", // France
  // French overseas territories — same regional partition as France in the
  // backend's stargate /login route (see backend/specs/stargate/1.0).
  "GP", "MQ", "GF", "RE", "YT", "MF", "BL", "PM", "WF", "PF", "NC", "TF",
]);

export async function inferRegionViaStargate(opts: {
  staging: boolean;
}): Promise<"us" | "fr"> {
  const url = STARGATE_URLS[opts.staging ? "staging" : "prod"];
  const res = await httpsCall("GET", url, { Accept: "application/json" });
  if (res.status !== 200) {
    throw new Error(
      `Stargate region probe failed: GET ${url} returned ${res.status}. ` +
        `Pass --region us|fr to skip auto-detection.`
    );
  }
  let parsed: { userCountry?: string };
  try {
    parsed = JSON.parse(res.body);
  } catch {
    throw new Error(`Stargate region probe returned non-JSON body`);
  }
  const country = parsed.userCountry;
  if (!country || typeof country !== "string") {
    throw new Error(`Stargate response missing userCountry: ${res.body.slice(0, 200)}`);
  }
  if (country === "US") return "us";
  if (FR_COUNTRY_CODES.has(country)) return "fr";
  throw new Error(
    `Stargate detected your country as ${country}, which isn't mapped to a ` +
      `Leadbay region. Pass --region us|fr explicitly.`
  );
}

// ────────────────────────────────────────────────────────────────────────────
// PKCE

/** Generate an RFC 7636 S256 PKCE pair. */
export function generatePkce(): PkcePair {
  // RFC 7636: verifier is 43..128 chars from [A-Z][a-z][0-9]-._~. 32 random
  // bytes → 43 chars after base64url-without-padding. Plenty of entropy.
  const verifier = base64UrlEncode(randomBytes(32));
  const challenge = base64UrlEncode(
    createHash("sha256").update(verifier, "ascii").digest()
  );
  return { verifier, challenge, method: "S256" };
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ────────────────────────────────────────────────────────────────────────────
// HTTP helpers (node:https for outbound calls, matches the rest of the codebase)

interface HttpsResult {
  status: number;
  body: string;
}

function httpsCall(
  method: "GET" | "POST",
  url: string,
  headers: Record<string, string>,
  body?: string
): Promise<HttpsResult> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const reqHeaders: Record<string, string | number> = { ...headers };
    if (body !== undefined) reqHeaders["Content-Length"] = Buffer.byteLength(body);
    const req = httpsRequestRaw(
      {
        hostname: u.hostname,
        port: u.port ? Number(u.port) : 443,
        path: u.pathname + u.search,
        method,
        headers: reqHeaders,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") })
        );
      }
    );
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Discovery

export async function fetchDiscoveryDoc(authServerBaseUrl: string): Promise<DiscoveryDoc> {
  const url = trimSlash(authServerBaseUrl) + "/.well-known/oauth-authorization-server";
  const res = await httpsCall("GET", url, { Accept: "application/json" });
  if (res.status !== 200) {
    throw new Error(
      `OAuth discovery failed: GET ${url} returned ${res.status}. ` +
        `Either OAuth isn't deployed to this backend yet, or the URL is wrong.`
    );
  }
  let doc: DiscoveryDoc;
  try {
    doc = JSON.parse(res.body);
  } catch {
    throw new Error(`OAuth discovery returned non-JSON body from ${url}`);
  }
  for (const field of ["authorization_endpoint", "token_endpoint", "registration_endpoint"] as const) {
    if (typeof doc[field] !== "string" || !doc[field]) {
      throw new Error(`OAuth discovery doc missing required field: ${field}`);
    }
  }
  if (doc.code_challenge_methods_supported && !doc.code_challenge_methods_supported.includes("S256")) {
    throw new Error(
      `OAuth server doesn't support S256 PKCE (only ${doc.code_challenge_methods_supported.join(", ")}). ` +
        `Aborting — plain PKCE is too weak for a public client.`
    );
  }
  return doc;
}

function trimSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

// ────────────────────────────────────────────────────────────────────────────
// Dynamic Client Registration (RFC 7591)

export async function registerClient(
  registrationEndpoint: string,
  params: { clientName: string; redirectUri: string; logoUri?: string }
): Promise<RegisterResponse> {
  const body = JSON.stringify({
    client_name: params.clientName,
    redirect_uris: [params.redirectUri],
    logo_uri: params.logoUri,
    token_endpoint_auth_method: "none", // public client
  });
  const res = await httpsCall(
    "POST",
    registrationEndpoint,
    { "Content-Type": "application/json", Accept: "application/json" },
    body
  );
  if (res.status === 429) {
    throw new Error(
      `OAuth client registration rate-limited (429). The backend allows ~10 ` +
        `registrations per IP per hour. Wait and retry, or use the password ` +
        `flow (drop the --oauth flag).`
    );
  }
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(
      `OAuth client registration failed: POST ${registrationEndpoint} → ${res.status} ${res.body.slice(0, 300)}`
    );
  }
  let parsed: RegisterResponse;
  try {
    parsed = JSON.parse(res.body);
  } catch {
    throw new Error(`OAuth client registration returned non-JSON body`);
  }
  if (!parsed.client_id) {
    throw new Error(`OAuth client registration response missing client_id`);
  }
  return parsed;
}

// ────────────────────────────────────────────────────────────────────────────
// Loopback listener (RFC 8252 §7.3 — 127.0.0.1, not "localhost")

export interface LoopbackListener {
  redirectUri: string;
  /** The 127.0.0.1 port actually bound (may differ from preferredPort on fallback). */
  port: number;
  /** Resolves once the user hits the callback URL with a valid `state`. */
  waitForCallback: () => Promise<{ code: string; state: string }>;
  /** Always call this in a finally{} — frees the port. */
  close: () => void;
}

export async function startLoopbackListener(opts: {
  expectedState: string;
  timeoutMs: number;
  /**
   * Try to bind these exact 127.0.0.1 ports in order; fall back to an ephemeral
   * port only if ALL are in use. The Leadbay backend requires the authorize
   * redirect_uri to EXACTLY match a registered one (it does NOT do RFC 8252
   * loopback-port matching), so reusing a cached client_id only works if the
   * port is stable. A short list (not a single port) means a transient
   * collision still lands on a STABLE, cacheable port — preserving the
   * register-once benefit instead of churning fresh registrations. Defaults to
   * ephemeral when unset/empty.
   */
  preferredPorts?: number[];
}): Promise<LoopbackListener> {
  // Resolved exactly once by the first matching /callback hit, or by timeout.
  let resolveCallback: (v: { code: string; state: string }) => void;
  let rejectCallback: (e: Error) => void;
  const callbackPromise = new Promise<{ code: string; state: string }>((res, rej) => {
    resolveCallback = res;
    rejectCallback = rej;
  });

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    // Only accept GET /callback?... — everything else is noise (favicon probes,
    // dev-tools prefetches, etc.). Reply 404 without leaking listener state.
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method !== "GET" || url.pathname !== "/callback") {
      res.statusCode = 404;
      res.end("Not Found");
      return;
    }
    const params = url.searchParams;
    const errParam = params.get("error");
    if (errParam) {
      const desc = params.get("error_description") ?? "";
      res.statusCode = 400;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(renderHtml("Authorization failed", `${errParam}${desc ? `: ${desc}` : ""}`));
      rejectCallback(new Error(`OAuth authorization denied: ${errParam}${desc ? ` (${desc})` : ""}`));
      return;
    }
    const code = params.get("code");
    const state = params.get("state");
    if (!code || !state) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(renderHtml("Authorization failed", "Missing code or state parameter."));
      rejectCallback(new Error("OAuth callback missing code or state"));
      return;
    }
    if (state !== opts.expectedState) {
      // CSRF defense. Don't even tell the client which value we expected.
      res.statusCode = 400;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(renderHtml("Authorization failed", "Invalid state parameter (possible CSRF)."));
      rejectCallback(new Error("OAuth callback state mismatch (possible CSRF)"));
      return;
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(renderHtml("You're signed in", "You can close this tab and return to the terminal."));
    resolveCallback({ code, state });
  });

  // 127.0.0.1 (not "localhost" — dual-stack IPv6 surprises). Prefer a stable
  // port so a cached client_id keeps matching; try each in order, then fall
  // back to an ephemeral port (0) only if every preferred port is taken.
  const bindPort = async (port: number) =>
    new Promise<void>((resolve, reject) => {
      const onErr = (e: Error) => reject(e);
      server.once("error", onErr);
      server.listen(port, "127.0.0.1", () => {
        server.off("error", onErr);
        resolve();
      });
    });
  let bound = false;
  for (const port of opts.preferredPorts ?? []) {
    try {
      await bindPort(port);
      bound = true;
      break;
    } catch {
      // Busy/unbindable — try the next stable port.
    }
  }
  if (!bound) await bindPort(0); // all preferred taken → ephemeral (works, but re-registers)

  const addr = server.address() as AddressInfo;
  const redirectUri = `http://127.0.0.1:${addr.port}/callback`;

  // Hard timeout — don't dangle forever if the user closes the browser tab.
  const timer = setTimeout(() => {
    rejectCallback(new Error(`OAuth login timed out after ${Math.round(opts.timeoutMs / 1000)}s`));
  }, opts.timeoutMs);

  return {
    redirectUri,
    port: addr.port,
    waitForCallback: () =>
      callbackPromise.finally(() => {
        clearTimeout(timer);
      }),
    close: () => {
      clearTimeout(timer);
      server.close();
    },
  };
}

function renderHtml(title: string, message: string): string {
  // Inline minimal HTML — no external deps, no theme; just a clean centered
  // message. Escape user-controlled text (error descriptions from the server).
  const safeTitle = escapeHtml(title);
  const safeMsg = escapeHtml(message);
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><title>${safeTitle} — Leadbay MCP</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
     display:flex;align-items:center;justify-content:center;height:100vh;
     margin:0;background:#fafafa;color:#111}
.card{padding:32px 40px;border:1px solid #eee;border-radius:12px;
      background:#fff;max-width:420px;text-align:center}
h1{font-size:18px;margin:0 0 12px;font-weight:600}
p{margin:0;color:#555;font-size:14px;line-height:1.5}
</style></head>
<body><div class="card"><h1>${safeTitle}</h1><p>${safeMsg}</p></div></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string)
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Token exchange

export async function exchangeCodeForToken(opts: {
  tokenEndpoint: string;
  code: string;
  codeVerifier: string;
  clientId: string;
  redirectUri: string;
}): Promise<{ accessToken: string }> {
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: opts.redirectUri,
    client_id: opts.clientId,
    code_verifier: opts.codeVerifier,
  }).toString();
  const res = await httpsCall(
    "POST",
    opts.tokenEndpoint,
    {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    form
  );
  if (res.status !== 200) {
    throw new Error(
      `OAuth token exchange failed: POST ${opts.tokenEndpoint} → ${res.status} ${res.body.slice(0, 300)}`
    );
  }
  let parsed: { access_token?: string; token_type?: string };
  try {
    parsed = JSON.parse(res.body);
  } catch {
    throw new Error("OAuth token endpoint returned non-JSON body");
  }
  if (!parsed.access_token) {
    throw new Error(`OAuth token response missing access_token: ${res.body.slice(0, 200)}`);
  }
  return { accessToken: parsed.access_token };
}

// ────────────────────────────────────────────────────────────────────────────
// Browser launch

/**
 * Ordered list of (command, args) candidates to try for a given platform.
 *
 * Each platform leads with the OS launcher's ABSOLUTE path, then falls back to
 * the bare command name (resolved via PATH). The absolute path matters because
 * Claude Desktop spawns .dxt/.mcpb stdio servers with a sanitized environment
 * whose PATH does NOT contain `open` / `xdg-open` / `cmd` — so `spawn("open")`
 * fails with ENOENT and the browser never opens (the exact OAuth-on-install
 * failure mode). Per the MCP spec, stdio servers can't assume the host shell's
 * PATH, so we resolve the launcher ourselves and only use PATH as a fallback
 * for unusual layouts (e.g. a custom Linux distro without /usr/bin/xdg-open).
 */
export function browserOpenCandidates(url: string): Array<{ cmd: string; args: string[] }> {
  const platform = process.platform;
  if (platform === "darwin") {
    // `open` lives at a fixed location on every macOS install.
    return [
      { cmd: "/usr/bin/open", args: [url] },
      { cmd: "open", args: [url] },
    ];
  }
  if (platform === "win32") {
    // `start` is a cmd builtin; double-quotes around an empty title prevent
    // start from treating the URL as the window title. %SystemRoot% points at
    // the Windows dir; fall back to the literal default + bare `cmd`.
    const sysRoot = process.env.SystemRoot || process.env.windir || "C:\\Windows";
    const cmdExe = `${sysRoot}\\System32\\cmd.exe`;
    return [
      { cmd: cmdExe, args: ["/c", "start", '""', url] },
      { cmd: "cmd", args: ["/c", "start", '""', url] },
    ];
  }
  // Linux / other: xdg-open is conventionally in /usr/bin (sometimes /usr/local/bin).
  return [
    { cmd: "/usr/bin/xdg-open", args: [url] },
    { cmd: "/usr/local/bin/xdg-open", args: [url] },
    { cmd: "xdg-open", args: [url] },
  ];
}

/**
 * Build the env to spawn the browser launcher with. On Linux, Claude Desktop
 * spawns the .dxt server with an INCONSISTENT environment — DISPLAY and
 * WAYLAND_DISPLAY are sometimes stripped (confirmed from a real install: a
 * launch logged `DISPLAY=<unset> WAYLAND=<unset>`). Without them, `xdg-open`
 * spawns "successfully" but can't reach the display server, so no tab opens —
 * the silent install-time failure. We can't change what the host passes, so we
 * reconstruct the missing vars from XDG_RUNTIME_DIR (the wayland-N socket
 * lives there) and the X11 socket dir, defaulting to the standard session
 * values. Harmless when they're already set (we don't overwrite).
 */
export function browserLaunchEnv(debug?: (msg: string) => void): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (process.platform !== "linux") return env;

  const runtimeDir = env.XDG_RUNTIME_DIR;

  if (!env.WAYLAND_DISPLAY && runtimeDir) {
    // Find a wayland-N socket in the runtime dir (wayland-0 is the default).
    try {
      const sock = readdirSync(runtimeDir).find((f) => /^wayland-\d+$/.test(f));
      if (sock) {
        env.WAYLAND_DISPLAY = sock;
        debug?.(`browserLaunchEnv: injected WAYLAND_DISPLAY=${sock}`);
      }
    } catch {
      /* runtime dir unreadable — fall through to X11 */
    }
  }

  if (!env.DISPLAY) {
    // X11 sockets live at /tmp/.X11-unix/X<N>; ":0" is the near-universal
    // default and works under XWayland too. Prefer the lowest-numbered.
    try {
      const x = readdirSync("/tmp/.X11-unix")
        .map((f) => f.match(/^X(\d+)$/)?.[1])
        .filter((n): n is string => !!n)
        .sort((a, b) => Number(a) - Number(b))[0];
      env.DISPLAY = x !== undefined ? `:${x}` : ":0";
    } catch {
      env.DISPLAY = ":0";
    }
    debug?.(`browserLaunchEnv: injected DISPLAY=${env.DISPLAY}`);
  }

  return env;
}

export async function openInBrowser(
  url: string,
  debug?: (msg: string) => void
): Promise<void> {
  // Cross-platform without a runtime dep. Detach the child so we don't keep it
  // tied to our process; on macOS `open` returns immediately anyway.
  //
  // Try each candidate in order; only the LAST ENOENT propagates. This makes
  // the launch independent of the inherited PATH (see browserOpenCandidates).
  const candidates = browserOpenCandidates(url);
  const launchEnv = browserLaunchEnv(debug);
  debug?.(
    `openInBrowser: platform=${process.platform} ` +
      `DISPLAY=${launchEnv.DISPLAY ?? "<unset>"} ` +
      `WAYLAND=${launchEnv.WAYLAND_DISPLAY ?? "<unset>"} ` +
      `DBUS=${launchEnv.DBUS_SESSION_BUS_ADDRESS ? "set" : "<unset>"} ` +
      `candidates=[${candidates.map((c) => c.cmd).join(", ")}]`
  );
  let lastErr: unknown;
  for (const { cmd, args } of candidates) {
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(cmd, args, { stdio: "ignore", detached: true, env: launchEnv });
        child.on("error", reject);
        child.on("spawn", () => {
          debug?.(`spawn OK: ${cmd} (pid=${child.pid})`);
          child.unref();
          resolve();
        });
      });
      return; // launched successfully
    } catch (err: any) {
      lastErr = err;
      debug?.(`spawn FAILED: ${cmd} → ${err?.code ?? err?.message ?? err}`);
      // ENOENT → this launcher path doesn't exist here; try the next candidate.
      // Any other error also falls through to the next candidate.
    }
  }
  debug?.(`openInBrowser: ALL candidates failed (lastErr=${(lastErr as any)?.message ?? lastErr})`);
  throw lastErr ?? new Error("no browser launcher available");
}

// ────────────────────────────────────────────────────────────────────────────
// Top-level flow

export async function oauthLogin(opts: OAuthLoginOptions): Promise<OAuthLoginResult> {
  const log = opts.log ?? (() => {});
  const open = opts.openBrowser ?? openInBrowser;
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;

  log(`Discovering OAuth endpoints at ${opts.authServerBaseUrl}…\n`);
  const doc = await fetchDiscoveryDoc(opts.authServerBaseUrl);

  const state = base64UrlEncode(randomBytes(16));
  const pkce = generatePkce();

  log("Starting loopback listener on 127.0.0.1…\n");
  const listener = await startLoopbackListener({
    expectedState: state,
    timeoutMs,
    preferredPorts: LEADBAY_LOOPBACK_PORTS,
  });
  try {
    // Reuse a cached client_id (keyed by the bound loopback port) — DCR is a
    // once-and-reuse operation; re-registering every launch is what exhausts
    // the backend's ~10-registrations/IP/hour limit (Claude Desktop fires
    // several launches per install via its probe-restarts).
    //
    // CRITICAL: the Leadbay backend pins the EXACT registered redirect_uri
    // (port included) and rejects any mismatch at /authorize ("This app's
    // redirect URL is not authorized") — it does NOT do RFC 8252 loopback-port
    // matching. So the redirect_uri we register MUST equal the one we send at
    // /authorize, and a cached client_id is only valid when the listener bound
    // the SAME port it was registered for. We bind a stable port
    // (LEADBAY_LOOPBACK_PORT) so this normally holds; the cache key includes the
    // port so a fallback to an ephemeral port forces a fresh registration for
    // that port instead of reusing a mismatched id.
    const boundPort = listener.port;
    let clientId = opts.getCachedClientId?.(boundPort);
    if (clientId) {
      log(`Reusing cached OAuth client_id (${clientId}) for port ${boundPort} — skipping registration.\n`);
    } else {
      log(`Registering client at ${doc.registration_endpoint} (redirect ${listener.redirectUri})…\n`);
      const registered = await registerClient(doc.registration_endpoint, {
        clientName: opts.clientName,
        redirectUri: listener.redirectUri, // exact bound-port redirect
        logoUri: opts.logoUri,
      });
      clientId = registered.client_id;
      try {
        opts.onClientRegistered?.(clientId, boundPort);
      } catch {
        /* persistence is best-effort — a write failure just means we re-register next time */
      }
    }

    const authorizeUrl = new URL(doc.authorization_endpoint);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("redirect_uri", listener.redirectUri);
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("code_challenge", pkce.challenge);
    authorizeUrl.searchParams.set("code_challenge_method", pkce.method);

    // Surface the live URL the moment it's known — the listener is already up,
    // so it's clickable now. The caller (non-blocking bootstrap) shows it to
    // the user, which is the reliable path when the spawned process can't open
    // a browser itself.
    if (opts.onAuthorizeUrl) {
      try {
        opts.onAuthorizeUrl(authorizeUrl.toString());
      } catch {
        /* never let a callback error abort the flow */
      }
    }

    log(`Opening browser to authorize…\n  ${authorizeUrl.toString()}\n`);
    try {
      await open(authorizeUrl.toString());
    } catch (err: any) {
      log(
        `Could not open browser automatically (${err?.message ?? err}). ` +
          `Open this URL manually:\n  ${authorizeUrl.toString()}\n`
      );
      // In a headless / sanitized launch (Claude Desktop .dxt), no human will
      // ever see that stderr line. Rather than dangle for the full 5-minute
      // callback timeout, bail now so the caller can surface a clickable
      // sign-in URL through a channel the user actually sees.
      if (opts.failFastOnOpenError) {
        throw new BrowserOpenFailedError(authorizeUrl.toString(), err);
      }
    }

    log("Waiting for authorization (5 min timeout)…\n");
    const { code } = await listener.waitForCallback();

    log("Exchanging authorization code for access token…\n");
    const { accessToken } = await exchangeCodeForToken({
      tokenEndpoint: doc.token_endpoint,
      code,
      codeVerifier: pkce.verifier,
      clientId,
      redirectUri: listener.redirectUri,
    });
    return { accessToken };
  } finally {
    listener.close();
  }
}
