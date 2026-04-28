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
} from "./types.js";

const LENS_CACHE_TTL_MS = 5 * 60 * 1000;
const TASTE_CACHE_TTL_MS = 10 * 60 * 1000;
const ME_CACHE_TTL_MS = 60 * 1000;
const MAX_CONCURRENT = 5;

const REGIONS: Record<string, string> = {
  us: "https://api-us.leadbay.app",
  fr: "https://api-fr.leadbay.app",
};

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
        `${baseUrl}/1.5/auth/login`,
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
    // The fixture path includes /1.5; the incoming basePath is /1.5/<path>.
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

  constructor(baseUrl: string, token?: string, region?: "us" | "fr") {
    this._baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token ?? null;
    this._region = region ?? (
      baseUrl === REGIONS.us ? "us" :
      baseUrl === REGIONS.fr ? "fr" : "custom"
    );
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

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    // Mock mode short-circuit (no auth required).
    if (process.env.LEADBAY_MOCK === "1") {
      return this.mockRequest<T>(method, path, body);
    }
    if (!this.token) {
      throw this.makeError(
        "NOT_AUTHENTICATED",
        "Not logged in to Leadbay",
        "Set LEADBAY_TOKEN in your MCP client config, or run: npx -y @leadbay/mcp install --email <you> --region <us|fr>",
        path
      );
    }
    await this.acquireSemaphore();
    try {
      const url = `${this._baseUrl}/1.5${path}`;
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.token}`,
      };
      if (body) {
        headers["Content-Type"] = "application/json";
      }

      const res = await httpsRequest(
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
        "Set LEADBAY_TOKEN in your MCP client config, or run: npx -y @leadbay/mcp install --email <you> --region <us|fr>",
        path
      );
    }
    await this.acquireSemaphore();
    try {
      const url = `${this._baseUrl}/1.5${path}`;
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.token}`,
      };
      if (body) {
        headers["Content-Type"] = "application/json";
      }

      const res = await httpsRequest(
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
  // the wizard at POST /1.5/imports.
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
        "Set LEADBAY_TOKEN in your MCP client config, or run: npx -y @leadbay/mcp install --email <you> --region <us|fr>",
        path
      );
    }
    await this.acquireSemaphore();
    try {
      const url = `${this._baseUrl}/1.5${path}`;
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": contentType,
      };

      const res = await httpsRequest(method, url, headers, body);

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
    const fullPath = `/1.5${path}`;
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
    const fullPath = `/1.5${path}`;
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
      return this.makeError(
        "AUTH_EXPIRED",
        "Authentication token expired or invalid",
        "Your LEADBAY_TOKEN is no longer valid. Regenerate it: npx -y @leadbay/mcp login --email <you> --region <us|fr>, then restart your MCP client.",
        endpoint
      );
    }
    // 429 is the canonical quota signal in production. 402 is legacy.
    if (
      status === 429 ||
      status === 402 ||
      parsed?.error === "quota_exceeded" ||
      parsed?.error?.code === "quota_exceeded"
    ) {
      return this.makeError(
        "QUOTA_EXCEEDED",
        retryAfter
          ? `Quota exceeded — retry in ${retryAfter}s`
          : "Quota exceeded",
        retryAfter
          ? `Wait ${retryAfter}s before retrying. Check leadbay_get_quota to see which resource window was hit.`
          : "Wait, then retry. Check leadbay_get_quota to see which resource window (daily/weekly/monthly) was hit.",
        endpoint,
        retryAfter
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
          endpoint
        );
      }
      return this.makeError(
        "FORBIDDEN",
        "Insufficient permissions",
        "Your token does not have access to this resource. Contact Leadbay support to verify account permissions.",
        endpoint
      );
    }
    if (status === 404) {
      return this.makeError(
        "NOT_FOUND",
        parsed?.message || parsed?.error?.message || "Resource not found",
        "Verify the ID is correct",
        endpoint
      );
    }
    return this.makeError(
      "API_ERROR",
      parsed?.message || parsed?.error?.message || `API error (${status})`,
      "Try again or check the Leadbay API status",
      endpoint
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
        this.defaultLensId = me.last_requested_lens;
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

  makeError(
    code: string,
    message: string,
    hint: string,
    endpoint?: string,
    retry_after?: number | null
  ): LeadbayError {
    const out: LeadbayError = { error: true, code, message, hint };
    if (endpoint || this._region) {
      out._meta = {
        region: this._region,
        endpoint: endpoint ?? "",
        latency_ms: this._lastMeta?.latency_ms ?? null,
        retry_after: retry_after ?? null,
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
