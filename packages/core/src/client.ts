import https from "node:https";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type {
  LeadbayError,
  LensPayload,
  UserMePayload,
  IdealBuyerProfilePayload,
  PurchaseIntentTagPayload,
  AiAgentQuestionPayload,
  RequestMeta,
  PaginatedNotifications,
  WsAuthResponse,
} from "./types.js";

const LENS_CACHE_TTL_MS = 5 * 60 * 1000;
const TASTE_CACHE_TTL_MS = 10 * 60 * 1000;
const ME_CACHE_TTL_MS = 60 * 1000;
const MAX_CONCURRENT = 5;

const REGIONS: Record<string, string> = {
  us: "https://api-us.leadbay.app",
  fr: "https://api-fr.leadbay.app",
};

// Backend API version. Single source of truth — every request path the client
// builds is mounted under this prefix. Bump here to move the whole MCP data
// plane to a new backend version.
export const API_VERSION = "1.6";
export const API_PREFIX = `/${API_VERSION}`;

interface HttpResult {
  status: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
  latency_ms: number;
}

// Use node:https directly — the OpenClaw gateway patches globalThis.fetch
// which intercepts outgoing requests and causes auth failures.
function httpsRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: string | Buffer
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const parsed = new URL(url);
    const reqHeaders: Record<string, string | number> = { ...headers };
    if (body !== undefined) {
      reqHeaders["Content-Length"] = Buffer.byteLength(body);
    }
    const req = https.request(
      {
        hostname: parsed.hostname,
        port: 443,
        path: parsed.pathname + parsed.search,
        method,
        headers: reqHeaders,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
            headers: res.headers as Record<string, string | string[] | undefined>,
            latency_ms: Date.now() - start,
          });
        });
      }
    );
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

export interface TasteProfileResult {
  idealBuyerProfile: IdealBuyerProfilePayload | null;
  purchaseIntentTags: PurchaseIntentTagPayload[];
  qualificationQuestions: AiAgentQuestionPayload[];
}

export interface CreateClientConfig {
  token?: string;
  region?: "us" | "fr";
  baseUrl?: string;
}

export function createClient(config: CreateClientConfig = {}): LeadbayClient {
  const region = config.region ?? "us";
  const baseUrl = config.baseUrl ?? REGIONS[region];
  if (!baseUrl) {
    throw new Error(
      `Leadbay: unknown region "${region}". Supported: ${Object.keys(REGIONS).join(", ")}. Or pass an explicit baseUrl.`
    );
  }
  return new LeadbayClient(baseUrl, config.token, region);
}

// Human-readable login error. Backends sometimes return 401 with an empty body;
// naive `${baseUrl}: ${body}` leaves a dangling colon. Attach a status-specific
// hint so non-technical users see "wrong email or password?" instead of a bare
// status code.
export function formatLoginError(
  status: number,
  body: string,
  baseUrl: string
): string {
  const trimmed = body.trim();
  const head = `login failed (${status}) at ${baseUrl}`;
  const hint =
    status === 401 ? " (wrong email or password?)"
    : status === 429 ? " (rate-limited; wait and retry)"
    : status >= 500 ? " (server error; try again shortly)"
    : "";
  if (!trimmed) return head + hint;
  return `${head}: ${trimmed.slice(0, 200)}${hint}`;
}

// Probe both regions to find which one this email/password works on.
// Returns the region (us|fr) and bearer token. Throws if neither succeeds.
export async function resolveRegion(
  email: string,
  password: string,
  startWith: "us" | "fr" = "us"
): Promise<{ region: "us" | "fr"; baseUrl: string; token: string; verified: boolean }> {
  const order: Array<"us" | "fr"> =
    startWith === "fr" ? ["fr", "us"] : ["us", "fr"];

  let lastErr: { kind: "http"; status: number; body: string; region: "us" | "fr"; baseUrl: string } |
                { kind: "network"; error: unknown; region: "us" | "fr"; baseUrl: string } |
                null = null;
  for (const region of order) {
    const baseUrl = REGIONS[region];
    const body = JSON.stringify({ email, password });
    try {
      const res = await httpsRequest(
        "POST",
        `${baseUrl}${API_PREFIX}/auth/login`,
        { "Content-Type": "application/json" },
        body
      );
      if (res.status === 200) {
        const parsed = JSON.parse(res.body);
        if (parsed?.token) {
          return {
            region,
            baseUrl,
            token: parsed.token,
            verified: parsed.verified === true,
          };
        }
      }
      lastErr = { kind: "http", status: res.status, body: res.body, region, baseUrl };
    } catch (e) {
      lastErr = { kind: "network", error: e, region, baseUrl };
    }
  }

  const detail = lastErr?.kind === "http"
    ? formatLoginError(lastErr.status, lastErr.body, lastErr.baseUrl)
    : lastErr?.kind === "network"
    ? `network error at ${lastErr.baseUrl}: ${(lastErr.error as Error)?.message ?? String(lastErr.error)}`
    : "no attempts made";
  throw new Error(
    `Leadbay login failed in both regions (us, fr). ${detail}`
  );
}

// ─── Mock mode (LEADBAY_MOCK=1) ──────────────────────────────────────────
//
// When enabled, GET requests are served from on-disk fixtures (the JSON dumps
// under .context/leadbay-live-shapes/ produced by the live probe scripts).
// POST/DELETE requests are journaled to an in-process Map and return
// {mocked: true, would_call: {...}}.
//
// Fixtures are matched by the trailing path segment of the request URL against
// each fixture's `request.url` field (also a trailing match). First fixture
// loaded for a given (method, path) wins. Designed for agent-author dry-running,
// not for fidelity.

interface MockFixture {
  method: string;
  path: string;
  status: number;
  body: any;
  headers: Record<string, string>;
}

let _mockFixtures: MockFixture[] | null = null;
let _mockJournal: Array<{ method: string; path: string; body?: unknown; ts: number }> = [];

function loadMockFixtures(dir: string): MockFixture[] {
  if (!existsSync(dir)) return [];
  const out: MockFixture[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const raw = readFileSync(join(dir, f), "utf8");
      const parsed = JSON.parse(raw);
      if (!parsed.request || !parsed.response) continue;
      const url: string = parsed.request.url ?? "";
      const u = new URL(url);
      out.push({
        method: parsed.request.method ?? "GET",
        path: u.pathname + u.search,
        status: parsed.response.status,
        body: parsed.response.body,
        headers: parsed.response.headers ?? {},
      });
    } catch {
      // ignore malformed fixtures
    }
  }
  return out;
}

function ensureMockLoaded(): void {
  if (_mockFixtures !== null) return;
  const dir =
    process.env.LEADBAY_MOCK_DIR ??
    join(process.cwd(), ".context", "leadbay-live-shapes");
  _mockFixtures = loadMockFixtures(dir);
  if (process.env.LEADBAY_MOCK === "1") {
    process.stderr.write(
      `[leadbay mock] loaded ${_mockFixtures.length} fixtures from ${dir}\n`
    );
  }
}

function findMockFixture(
  method: string,
  basePath: string
): MockFixture | null {
  ensureMockLoaded();
  if (!_mockFixtures) return null;
  for (const f of _mockFixtures) {
    if (f.method !== method) continue;
    // The fixture path includes /1.6; the incoming basePath is /1.6/<path>.
    if (basePath === f.path) return f;
    // Loose match: pathname segments equal (ignore query string differences).
    const fNoQs = f.path.split("?")[0];
    const bNoQs = basePath.split("?")[0];
    if (fNoQs === bNoQs) return f;
  }
  return null;
}

export function getMockJournal(): typeof _mockJournal {
  return _mockJournal;
}

export function clearMockJournal(): void {
  _mockJournal = [];
}

export class LeadbayClient {
  private token: string | null;
  private _baseUrl: string;
  private _region: "us" | "fr" | "custom";
  private defaultLensId: number | null = null;
  private defaultLensCachedAt: number | null = null;
  private mePayload: UserMePayload | null = null;
  private mePayloadCachedAt: number | null = null;
  private tasteProfile: TasteProfileResult | null = null;
  private tasteProfileCachedAt: number | null = null;

  // Simple semaphore for concurrency limiting.
  private activeRequests = 0;
  private waitQueue: Array<() => void> = [];

  // Selection-state Mutex. The /leads/selection/* endpoints share global
  // server-side state per token, so two parallel composites that each call
  // select → action → clear would clobber each other. Composites that touch
  // selection acquire this lock for the lifetime of their select…clear cycle.
  private selectionLockHeld = false;
  private selectionWaitQueue: Array<() => void> = [];

  // Last response metadata — composites can read this after a request to
  // surface latency/region/retry_after to the agent in their `_meta` block.
  private _lastMeta: RequestMeta | null = null;

  constructor(baseUrl: string | { baseUrl: string; bearer?: string; region?: "us" | "fr" }, token?: string, region?: "us" | "fr") {
    if (typeof baseUrl === "object") {
      const opts = baseUrl;
      this._baseUrl = opts.baseUrl.replace(/\/+$/, "");
      this.token = opts.bearer ?? null;
      this._region = opts.region ?? (opts.baseUrl === REGIONS.us ? "us" : opts.baseUrl === REGIONS.fr ? "fr" : "custom");
    } else {
      this._baseUrl = baseUrl.replace(/\/+$/, "");
      this.token = token ?? null;
      this._region = region ?? (baseUrl === REGIONS.us ? "us" : baseUrl === REGIONS.fr ? "fr" : "custom");
    }
  }

  get baseUrl(): string {
    return this._baseUrl;
  }

  get region(): "us" | "fr" | "custom" {
    return this._region;
  }

  get lastMeta(): RequestMeta | null {
    return this._lastMeta;
  }

  // Used by login when region auto-detect picks a different backend than the
  // one the client was constructed with.
  setBaseUrl(baseUrl: string, region?: "us" | "fr"): void {
    this._baseUrl = baseUrl.replace(/\/+$/, "");
    this._region = region ?? (
      baseUrl === REGIONS.us ? "us" :
      baseUrl === REGIONS.fr ? "fr" : "custom"
    );
    // Region change invalidates everything — different tenant.
    this.defaultLensId = null;
    this.defaultLensCachedAt = null;
    this.mePayload = null;
    this.mePayloadCachedAt = null;
    this.tasteProfile = null;
    this.tasteProfileCachedAt = null;
  }

  setToken(token: string): void {
    this.token = token;
  }

  get isAuthenticated(): boolean {
    return this.token !== null;
  }

  // Test-only getter for concurrency assertions
  get _semaphoreState(): { active: number; queued: number } {
    return { active: this.activeRequests, queued: this.waitQueue.length };
  }

  private async acquireSemaphore(): Promise<void> {
    if (this.activeRequests < MAX_CONCURRENT) {
      this.activeRequests++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waitQueue.push(() => {
        this.activeRequests++;
        resolve();
      });
    });
  }

  private releaseSemaphore(): void {
    this.activeRequests--;
    const next = this.waitQueue.shift();
    if (next) next();
  }

  // Selection Mutex — composites that touch /leads/selection/* must wrap
  // their select…clear cycle in acquire/release to avoid clobbering across
  // concurrent invocations.
  async acquireSelectionLock(): Promise<void> {
    if (!this.selectionLockHeld) {
      this.selectionLockHeld = true;
      return;
    }
    return new Promise<void>((resolve) => {
      this.selectionWaitQueue.push(() => {
        this.selectionLockHeld = true;
        resolve();
      });
    });
  }

  releaseSelectionLock(): void {
    this.selectionLockHeld = false;
    const next = this.selectionWaitQueue.shift();
    if (next) next();
  }

  // Leadbay tokens don't expire, so a 401 is almost always a transient
  // server-side blip. Retry the request ONCE before surfacing it — a single
  // retry clears the vast majority of these without the agent ever seeing an
  // error. If the retry also 401s, it's a real Leadbay-side problem and the
  // error envelope says so.
  //
  // Arrow-function field so `this` stays bound even when the method is passed
  // as a bare reference (see request()'s ternary). Retries are GET-ONLY: a 401
  // on a write (POST/PUT/DELETE) may arrive AFTER the mutation already committed
  // server-side, so blindly re-sending it would double-execute the write. Reads
  // are idempotent, so retrying them is safe. The 250ms backoff releases the
  // concurrency slot first (release → sleep → re-acquire) so a wave of 401s
  // doesn't pin all MAX_CONCURRENT slots in setTimeout and stall the queue.
  private httpsRequestWithRetry = async (
    method: string,
    url: string,
    headers: Record<string, string>,
    body?: string | Buffer
  ): Promise<HttpResult> => {
    const res = await httpsRequest(method, url, headers, body);
    if (res.status === 401 && method.toUpperCase() === "GET") {
      this.releaseSemaphore();
      try {
        await new Promise((r) => setTimeout(r, 250));
      } finally {
        await this.acquireSemaphore();
      }
      return httpsRequest(method, url, headers, body);
    }
    return res;
  };

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    opts?: { retryOn401?: boolean }
  ): Promise<T> {
    // Mock mode short-circuit (no auth required).
    if (process.env.LEADBAY_MOCK === "1") {
      return this.mockRequest<T>(method, path, body);
    }
    if (!this.token) {
      throw this.makeError(
        "NOT_AUTHENTICATED",
        "Not logged in to Leadbay",
        "Set LEADBAY_TOKEN in your MCP client config, or run: npx -y -p @leadbay/mcp@latest installer",
        path
      );
    }
    // Auto-retry a transient 401 on normal calls; the startup auth-probe opts
    // out (retryOn401:false) so a bad token fails fast instead of double-probing.
    const retryOn401 = opts?.retryOn401 !== false;
    await this.acquireSemaphore();
    try {
      const url = `${this._baseUrl}${API_PREFIX}${path}`;
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.token}`,
      };
      if (body) {
        headers["Content-Type"] = "application/json";
      }

      const res = await (retryOn401 ? this.httpsRequestWithRetry : httpsRequest)(
        method,
        url,
        headers,
        body ? JSON.stringify(body) : undefined
      );

      this._lastMeta = {
        region: this._region,
        endpoint: `${method} ${path}`,
        latency_ms: res.latency_ms,
        retry_after: parseRetryAfter(res.headers["retry-after"]),
      };

      if (res.status === 204) {
        return null as T;
      }

      if (res.status < 200 || res.status >= 300) {
        throw this.mapErrorResponse(res.status, res.body, path, res.headers);
      }

      return JSON.parse(res.body) as T;
    } finally {
      this.releaseSemaphore();
    }
  }

  async requestVoid(method: string, path: string, body?: unknown): Promise<void> {
    if (process.env.LEADBAY_MOCK === "1") {
      await this.mockRequest<void>(method, path, body);
      return;
    }
    if (!this.token) {
      throw this.makeError(
        "NOT_AUTHENTICATED",
        "Not logged in to Leadbay",
        "Set LEADBAY_TOKEN in your MCP client config, or run: npx -y -p @leadbay/mcp@latest installer",
        path
      );
    }
    await this.acquireSemaphore();
    try {
      const url = `${this._baseUrl}${API_PREFIX}${path}`;
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.token}`,
      };
      if (body) {
        headers["Content-Type"] = "application/json";
      }

      const res = await this.httpsRequestWithRetry(
        method,
        url,
        headers,
        body ? JSON.stringify(body) : undefined
      );

      this._lastMeta = {
        region: this._region,
        endpoint: `${method} ${path}`,
        latency_ms: res.latency_ms,
        retry_after: parseRetryAfter(res.headers["retry-after"]),
      };

      if (res.status < 200 || res.status >= 300) {
        throw this.mapErrorResponse(res.status, res.body, path, res.headers);
      }
    } finally {
      this.releaseSemaphore();
    }
  }

  // Like request(), but the caller supplies the Content-Type and the already-
  // serialized body (string for text payloads such as CSV; Buffer for binary
  // uploads). Auth, semaphore, error mapping, _lastMeta, and mock-mode all
  // mirror request() exactly. Used by leadbay_import_leads to upload CSVs to
  // the wizard at POST /1.6/imports.
  async requestRawBinary<T>(
    method: string,
    path: string,
    contentType: string,
    body: string | Buffer
  ): Promise<T> {
    if (process.env.LEADBAY_MOCK === "1") {
      return this.mockRequestBinary<T>(method, path, contentType, body);
    }
    if (!this.token) {
      throw this.makeError(
        "NOT_AUTHENTICATED",
        "Not logged in to Leadbay",
        "Set LEADBAY_TOKEN in your MCP client config, or run: npx -y -p @leadbay/mcp@latest installer",
        path
      );
    }
    await this.acquireSemaphore();
    try {
      const url = `${this._baseUrl}${API_PREFIX}${path}`;
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": contentType,
      };

      const res = await this.httpsRequestWithRetry(method, url, headers, body);

      this._lastMeta = {
        region: this._region,
        endpoint: `${method} ${path}`,
        latency_ms: res.latency_ms,
        retry_after: parseRetryAfter(res.headers["retry-after"]),
      };

      if (res.status === 204) {
        return null as T;
      }

      if (res.status < 200 || res.status >= 300) {
        throw this.mapErrorResponse(res.status, res.body, path, res.headers);
      }

      return JSON.parse(res.body) as T;
    } finally {
      this.releaseSemaphore();
    }
  }

  private mockRequest<T>(method: string, path: string, body?: unknown): T {
    const fullPath = `${API_PREFIX}${path}`;
    this._lastMeta = {
      region: this._region,
      endpoint: `${method} ${path}`,
      latency_ms: 0,
      retry_after: null,
    };
    if (method === "GET") {
      const fixture = findMockFixture("GET", fullPath);
      if (!fixture) {
        throw this.makeError(
          "MOCK_NOT_FOUND",
          `LEADBAY_MOCK=1: no fixture for GET ${path}`,
          `Add a fixture to LEADBAY_MOCK_DIR (default: ./.context/leadbay-live-shapes/) — run a probe script to generate one.`,
          path
        );
      }
      if (fixture.status === 204) return null as T;
      return fixture.body as T;
    }
    // Writes: journal + return mocked envelope.
    _mockJournal.push({ method, path: fullPath, body, ts: Date.now() });
    return {
      mocked: true,
      would_call: { method, path: fullPath, body },
    } as unknown as T;
  }

  private mockRequestBinary<T>(
    method: string,
    path: string,
    contentType: string,
    body: string | Buffer
  ): T {
    const fullPath = `${API_PREFIX}${path}`;
    this._lastMeta = {
      region: this._region,
      endpoint: `${method} ${path}`,
      latency_ms: 0,
      retry_after: null,
    };
    if (method === "GET") {
      // Binary GETs aren't a thing in Leadbay's API today; fall through to
      // standard fixture lookup so the same mocks apply.
      const fixture = findMockFixture("GET", fullPath);
      if (!fixture) {
        throw this.makeError(
          "MOCK_NOT_FOUND",
          `LEADBAY_MOCK=1: no fixture for GET ${path}`,
          `Add a fixture to LEADBAY_MOCK_DIR (default: ./.context/leadbay-live-shapes/) — run a probe script to generate one.`,
          path
        );
      }
      if (fixture.status === 204) return null as T;
      return fixture.body as T;
    }
    const journalBody = {
      _binary: true,
      length: Buffer.byteLength(body),
      content_type: contentType,
    };
    _mockJournal.push({
      method,
      path: fullPath,
      body: journalBody,
      ts: Date.now(),
    });
    return {
      mocked: true,
      would_call: { method, path: fullPath, body: journalBody },
    } as unknown as T;
  }

  private mapErrorResponse(
    status: number,
    rawBody: string,
    endpoint: string,
    headers: Record<string, string | string[] | undefined>
  ): LeadbayError {
    let parsed: any;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      parsed = null;
    }

    const retryAfter = parseRetryAfter(headers["retry-after"]);

    if (status === 401) {
      // Leadbay tokens don't expire on a timer, and request() already retried
      // this call once on the first 401. The one thing we can state for certain
      // is that the token did NOT time out. A persistent 401 is EITHER a
      // Leadbay-side hiccup OR a genuine logout/revocation (per Milan, a 401 can
      // mean the user is logged out) — we can't tell which from here, so name
      // both causes and assert neither. Don't claim the login is fine, and don't
      // push re-login as the default fix either.
      // (Code stays AUTH_EXPIRED for backward compat with the MCP auth handlers.)
      return this.makeError(
        "AUTH_EXPIRED",
        "Leadbay rejected this request (401)",
        "Leadbay tokens don't expire on a timer, so this isn't a stale token. A 401 here is usually a Leadbay-side hiccup, but can also mean the user logged out. Try again shortly; if it persists, offer to report it to the team.",
        endpoint,
        null,
        status
      );
    }
    // 429 is the canonical quota signal in production. 402 is legacy.
    if (
      status === 429 ||
      status === 402 ||
      parsed?.error === "quota_exceeded" ||
      parsed?.error?.code === "quota_exceeded"
    ) {
      const hintBase = retryAfter
        ? `Wait ${retryAfter}s before retrying`
        : "Wait, then retry";
      return this.makeError(
        "QUOTA_EXCEEDED",
        retryAfter
          ? `Quota exceeded — retry in ${retryAfter}s`
          : "Quota exceeded",
        // The Leadbay user can either wait for the window to reset OR top up
        // AI credits (which clears the throttle immediately). Tell the agent
        // both options exist so it offers the top-up path to the user instead
        // of forcing them to wait. Surface leadbay_create_topup_link so the
        // agent can generate the URL itself instead of asking the user to
        // navigate to a website. Once the user has topped up, the previous
        // 429 is stale — retry the failed call.
        `${hintBase}, OR top up AI credits — top-ups clear the throttle immediately. ` +
          `Offer the user to generate a Stripe checkout URL via leadbay_create_topup_link, OR direct them to app.leadbay.ai → Billing. ` +
          `Check leadbay_account_status / leadbay_get_quota to see which resource window (daily/weekly/monthly) was hit. ` +
          `Once the user has topped up, the previous QUOTA_EXCEEDED is stale — re-call leadbay_account_status to refresh, then RETRY the original operation.`,
        endpoint,
        retryAfter,
        status
      );
    }
    if (status === 403) {
      const msg = parsed?.message || parsed?.error || parsed?.error?.message || "";
      if (
        typeof msg === "string" &&
        (msg.includes("suspend") || msg.includes("billing"))
      ) {
        return this.makeError(
          "BILLING_SUSPENDED",
          "Account billing is suspended",
          "Your Leadbay account billing is suspended. Contact Leadbay support.",
          endpoint,
          null,
          status
        );
      }
      return this.makeError(
        "FORBIDDEN",
        "Insufficient permissions",
        "Your token does not have access to this resource. Contact Leadbay support to verify account permissions.",
        endpoint,
        null,
        status
      );
    }
    if (status === 404) {
      return this.makeError(
        "NOT_FOUND",
        parsed?.message || parsed?.error?.message || "Resource not found",
        "Verify the ID is correct",
        endpoint,
        null,
        status
      );
    }
    return this.makeError(
      "API_ERROR",
      parsed?.message || parsed?.error?.message || `API error (${status})`,
      "Try again or check the Leadbay API status",
      endpoint,
      null,
      status
    );
  }

  // /me cache (60s TTL). Separate from resolveOrgId() which still works for
  // legacy callers (it now delegates here).
  async resolveMe(force = false): Promise<UserMePayload> {
    const now = Date.now();
    if (
      !force &&
      this.mePayload !== null &&
      this.mePayloadCachedAt !== null &&
      now - this.mePayloadCachedAt < ME_CACHE_TTL_MS
    ) {
      return this.mePayload;
    }
    const me = await this.request<UserMePayload>("GET", "/users/me");
    this.mePayload = me;
    this.mePayloadCachedAt = now;
    return me;
  }

  // Force re-fetch on next resolveMe(). Call from any tool that mutates a
  // /me-cached field (last_requested_lens, billing, etc.).
  invalidateMe(): void {
    this.mePayload = null;
    this.mePayloadCachedAt = null;
  }

  async resolveDefaultLens(): Promise<number> {
    const now = Date.now();
    if (
      this.defaultLensId !== null &&
      this.defaultLensCachedAt !== null &&
      now - this.defaultLensCachedAt < LENS_CACHE_TTL_MS
    ) {
      return this.defaultLensId;
    }

    // Prefer /me.last_requested_lens (cheaper than scanning /lenses).
    try {
      const me = await this.resolveMe();
      if (me.last_requested_lens != null) {
        // last_requested_lens may arrive as a string ("40005") or number;
        // defaultLensId is the numeric internal id, so coerce.
        this.defaultLensId = Number(me.last_requested_lens);
        this.defaultLensCachedAt = now;
        return this.defaultLensId;
      }
    } catch {
      // fall through to /lenses scan
    }

    const lenses = await this.request<LensPayload[]>("GET", "/lenses");

    const active = lenses.find((l) => l.is_last_active);
    const fallback = active || lenses.find((l) => l.is_default || l.default) || lenses[0];

    if (!fallback) {
      throw this.makeError(
        "NO_LENS",
        "No lenses found on your account",
        "Open the Leadbay web UI once to provision your first lens, or create one via the API",
        "GET /lenses"
      );
    }

    this.defaultLensId = fallback.id;
    this.defaultLensCachedAt = now;
    return this.defaultLensId;
  }

  invalidateDefaultLens(): void {
    this.defaultLensId = null;
    this.defaultLensCachedAt = null;
  }

  async resolveOrgId(): Promise<string> {
    const me = await this.resolveMe();
    return me.organization.id;
  }

  async resolveTasteProfile(): Promise<TasteProfileResult> {
    const now = Date.now();
    if (
      this.tasteProfile !== null &&
      this.tasteProfileCachedAt !== null &&
      now - this.tasteProfileCachedAt < TASTE_CACHE_TTL_MS
    ) {
      return this.tasteProfile;
    }

    const orgId = await this.resolveOrgId();

    const [ibpResult, tagsResult, questionsResult] =
      await Promise.allSettled([
        this.request<IdealBuyerProfilePayload>(
          "GET",
          `/organizations/${orgId}/ideal_buyer_profile`
        ),
        this.request<PurchaseIntentTagPayload[]>(
          "GET",
          `/organizations/${orgId}/purchase_intent_tags`
        ),
        this.request<AiAgentQuestionPayload[]>(
          "GET",
          `/organizations/${orgId}/ai_agent_questions`
        ),
      ]);

    this.tasteProfile = {
      idealBuyerProfile:
        ibpResult.status === "fulfilled" ? ibpResult.value : null,
      purchaseIntentTags:
        tagsResult.status === "fulfilled" ? tagsResult.value : [],
      qualificationQuestions:
        questionsResult.status === "fulfilled" ? questionsResult.value : [],
    };
    this.tasteProfileCachedAt = now;
    return this.tasteProfile;
  }

  invalidateTasteProfile(): void {
    this.tasteProfile = null;
    this.tasteProfileCachedAt = null;
  }

  async prefetchOrgData(): Promise<void> {
    await this.resolveOrgId();
    await this.resolveTasteProfile();
  }

  // ─── Notifications helpers ────────────────────────────────────────────
  // Backend exposes `GET /notifications`, `POST /notifications/{id}/seen`,
  // `POST /notifications/{id}/archive`, plus `GET /ws/ticket?v=1.0` to mint
  // a one-shot WS URL. See backend/docs/adr/notifications.md for shape.

  async listNotifications(args: {
    archived?: boolean;
    page?: number;
    count?: number;
  } = {}): Promise<PaginatedNotifications> {
    const params = new URLSearchParams();
    params.set("archived", String(args.archived ?? false));
    params.set("page", String(args.page ?? 0));
    params.set("count", String(args.count ?? 50));
    return this.request<PaginatedNotifications>(
      "GET",
      `/notifications?${params.toString()}`
    );
  }

  async acknowledgeNotification(
    notificationId: string,
    action: "seen" | "archive" = "seen"
  ): Promise<void> {
    await this.requestVoid(
      "POST",
      `/notifications/${notificationId}/${action}`
    );
  }

  async getWsTicket(): Promise<WsAuthResponse> {
    // Mounted under /1.6/auth/ws (see backend/AuthRoutes.kt::authRoutes).
    return this.request<WsAuthResponse>("GET", "/auth/ws?v=1.0");
  }

  makeError(
    code: string,
    message: string,
    hint: string,
    endpoint?: string,
    retry_after?: number | null,
    http_status?: number
  ): LeadbayError {
    const out: LeadbayError = { error: true, code, message, hint };
    if (endpoint || this._region) {
      out._meta = {
        region: this._region,
        endpoint: endpoint ?? "",
        latency_ms: this._lastMeta?.latency_ms ?? null,
        retry_after: retry_after ?? null,
        ...(http_status !== undefined ? { http_status } : {}),
      };
    }
    return out;
  }
}

function parseRetryAfter(
  value: string | string[] | undefined
): number | null {
  if (!value) return null;
  const v = Array.isArray(value) ? value[0] : value;
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  // RFC 7231 also allows HTTP-date — try Date.parse
  const date = Date.parse(v);
  if (Number.isFinite(date)) {
    return Math.max(0, Math.round((date - Date.now()) / 1000));
  }
  return null;
}

export { REGIONS };
