import https from "node:https";
import { AsyncLocalStorage } from "node:async_hooks";
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
// Whether a 401 on this method is safe to auto-retry. Reads are idempotent;
// writes may have committed server-side before the 401 came back, so replaying
// them could double-execute the mutation. Single source of truth for the rule —
// httpsRequestWithRetry enforces it, and the error mapper reads it so the hint
// never claims a retry that did not happen.
export const retriesOn401 = (method: string): boolean => method.toUpperCase() === "GET";

const ME_CACHE_TTL_MS = 60 * 1000;
const MAX_CONCURRENT = 5;

/**
 * Backstop deadline for a single outbound request. NOT a latency budget for
 * Leadbay — three different layers answer three different questions, and this
 * one is the last of them:
 *
 *   how long does the USER wait?      the MCP host, via notifications/cancelled
 *                                     (the SDK sends it on its own request
 *                                     timeout AND when the user hits Cancel);
 *                                     we honour it — see requestSignalStore.
 *   how long does a WORKFLOW work?    the composite's own declared budgets —
 *                                     bulk_qualify 90s/lead and 300s total,
 *                                     import-leads 60s/phase and 300s total.
 *   how long may one SOCKET sit       this constant.
 *   unanswered?
 *
 * Leadbay's long work is launched, not awaited: `POST /leads/:id/web_fetch`
 * starts the AI and returns (166 ms measured against staging 2026-08-28, along
 * with 148 ms for a lens creation that computes a wishlist and 227 ms for
 * /leads/resolve), then the tool polls. So no request is long TODAY — but
 * picking a number from that measurement would encode "Leadbay never answers
 * after N seconds", which is a claim about a backend we do not own and which an
 * AI product will eventually break.
 *
 * So the number is anchored to OUR code instead: 10 minutes is 2x the longest
 * budget any workflow in this repo grants itself (300s). A request that outlives
 * the workflow that issued it has already been abandoned by its caller —
 * cancelling it can't lose an answer anyone is still waiting for, and it frees
 * the MAX_CONCURRENT slot it would otherwise hold forever.
 *
 * That last part is the whole point. node:https sets no socket timeout, so
 * before this a backend that completed the TCP handshake and then went silent
 * held its slot for the life of the process. With five slots, a handful of such
 * requests deadlocked every other tool on the client — product#4003: 28 of one
 * customer's calls hung up to 57 hours, a 36-hour outage on her only surface.
 */
export const DEFAULT_REQUEST_TIMEOUT_MS = 600_000;

/**
 * `LEADBAY_TIMEOUT_MS` — the deployment-level override for
 * DEFAULT_REQUEST_TIMEOUT_MS. Documented in packages/mcp/README.md as the
 * "per-request timeout override" since before product#4003, but nothing read it;
 * this makes the documented knob real rather than introducing a second name.
 *
 * `0` (or a negative value) opts a deployment out of the backstop entirely and
 * restores the pre-product#4003 unbounded behaviour. Read per request, not at
 * module load, so a test or a restart-free config change takes effect
 * immediately.
 */
function defaultTimeoutMs(): number {
  const raw = process.env.LEADBAY_TIMEOUT_MS;
  if (raw === undefined || raw.trim() === "") return DEFAULT_REQUEST_TIMEOUT_MS;
  const n = Number(raw);
  return Number.isFinite(n) ? n : DEFAULT_REQUEST_TIMEOUT_MS;
}

/**
 * Ambient cancellation for every request issued inside one tool call.
 *
 * The MCP SDK aborts the handler's AbortSignal on `notifications/cancelled`,
 * which it sends both when the user cancels and when its OWN request timeout
 * fires. server.ts already forwards that signal to `ToolContext.signal`, where
 * composites use it to stop polling — but the HTTP request in flight at that
 * moment kept running and kept its concurrency slot. So the host could give up
 * on a call in 60 seconds and the socket behind it would still be holding a slot
 * hours later. That, not the absence of a timeout, is what turned a stalled
 * backend into a dead session.
 *
 * Threading a `signal` argument through all 174 `client.request(...)` call sites
 * would be a far larger and more error-prone diff than this, and every one of
 * them would have to remember it forever. AsyncLocalStorage carries it for them:
 * server.ts wraps `tool.execute` once, and every request the tool makes — at any
 * async depth — inherits the right signal. Concurrent tool calls each get their
 * own store, so one tool's cancellation can never touch another's socket.
 *
 * Callers outside a tool invocation (telemetry identity, the hosted SSE refresh)
 * simply have no ambient signal and fall back to the backstop.
 */
const requestSignalStore = new AsyncLocalStorage<AbortSignal | undefined>();

export function runWithRequestSignal<T>(
  signal: AbortSignal | undefined,
  fn: () => T
): T {
  return requestSignalStore.run(signal, fn);
}

function makeCancelledError(method: string, url: string): Error & {
  code?: string;
} {
  // name stays "AbortError" because composites already branch on it
  // (_qualify-helpers, import-leads) to distinguish a user cancellation from a
  // genuine failure. `code` is the new, more specific handle.
  const err = new Error(`Request cancelled: ${method} ${url}`) as Error & {
    code?: string;
  };
  err.name = "AbortError";
  err.code = "CANCELLED";
  return err;
}

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

// One shape for every deadline expiry — the socket one below and the queue one
// in acquireSemaphore. Callers classify on `code`, so a second shape would make
// a queued timeout look like an unrelated failure.
function timeoutError(what: string): Error & { code?: string } {
  const err = new Error(what) as Error & { code?: string };
  err.code = "TIMEOUT"; // not an auth code — callers treat it as a transient fault
  return err;
}

// Use node:https directly — the OpenClaw gateway patches globalThis.fetch
// which intercepts outgoing requests and causes auth failures.
function httpsRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: string | Buffer,
  // Backstop deadline. node:https sets NO socket timeout by default, so a peer
  // that completes the TCP handshake and then stalls would leave this promise
  // pending indefinitely. Omitting it does NOT mean "unbounded" — it means
  // DEFAULT_REQUEST_TIMEOUT_MS. Callers that need a tighter bound (the hosted
  // auth probe, which walks candidate regions one after another) pass their own;
  // only an explicit `<= 0` disables it.
  timeoutMs?: number,
  // Explicit cancellation. Defaults to the ambient signal of the tool call this
  // request belongs to (requestSignalStore), which is the bound that actually
  // matters — the host's, not ours.
  signal?: AbortSignal
): Promise<HttpResult> {
  const deadlineMs = timeoutMs ?? defaultTimeoutMs();
  const abortSignal = signal ?? requestSignalStore.getStore();
  // Only a GET is safe to abort MID-FLIGHT. This is the same predicate
  // httpsRequestWithRetry already uses to decide what may be replayed, and for
  // the mirror-image reason: a write may have committed server-side before we
  // destroyed the socket. Reporting CANCELLED on a note that IS in the CRM makes
  // the agent tell the user it wasn't sent, or write it a second time — worse
  // than the stall this whole change exists to fix. A read has no side effect to
  // misreport, so aborting one is free.
  //
  // An in-flight write therefore runs to completion and releases its slot then;
  // the backstop still bounds it. Writes are a small minority of calls, so this
  // costs almost nothing against the deadlock it protects.
  const abortSafe = method.toUpperCase() === "GET";
  return new Promise((resolve, reject) => {
    const start = Date.now();
    // Already cancelled BEFORE we opened a socket — nothing has been sent, so
    // there is no committed write to misreport. Safe for every method.
    if (abortSignal?.aborted) {
      reject(makeCancelledError(method, url));
      return;
    }
    const parsed = new URL(url);
    const reqHeaders: Record<string, string | number> = { ...headers };
    if (body !== undefined) {
      reqHeaders["Content-Length"] = Buffer.byteLength(body);
    }
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    // One tool call can issue hundreds of requests against the SAME signal, so
    // every listener must come off on settle or the signal accumulates them and
    // Node warns about a leak.
    const clearDeadline = () => {
      if (deadline !== undefined) clearTimeout(deadline);
      if (onAbort) abortSignal?.removeEventListener("abort", onAbort);
    };
    const req = https.request(
      {
        hostname: parsed.hostname,
        port: 443,
        path: parsed.pathname + parsed.search,
        method,
        headers: reqHeaders,
        // Node aborts the socket and emits an AbortError on `error`, which the
        // handler below rejects with. Without this a cancelled tool call sat on
        // an in-flight GET until the server answered — the polling loop cannot
        // honour its advertised <=2s exit while blocked inside one.
        signal,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          clearDeadline();
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
            headers: res.headers as Record<string, string | string[] | undefined>,
            latency_ms: Date.now() - start,
          });
        });
      }
    );

    if (deadlineMs > 0) {
      deadline = setTimeout(() => {
        // destroy() actually cancels — it aborts the request and frees the
        // socket rather than leaving a stalled connection behind a raced
        // promise. Optional-called because the node:https test double is a bare
        // EventEmitter with no destroy().
        (req as { destroy?: (e?: Error) => void }).destroy?.();
        const err = new Error(
          `Request timed out after ${deadlineMs}ms: ${method} ${url}`
        ) as Error & { code?: string; timeout_ms?: number };
        err.code = "TIMEOUT"; // not an auth code — callers treat it as a transient fault
        err.timeout_ms = deadlineMs;
        reject(err);
      }, deadlineMs);
      // Never hold the process open on a deadline timer.
      (deadline as unknown as { unref?: () => void }).unref?.();
    }

    if (abortSignal && abortSafe) {
      onAbort = () => {
        // Same destroy() as the deadline path: abort the request and free the
        // socket. The caller's `finally` then releases the concurrency slot, so
        // a cancelled tool call stops holding one immediately instead of at the
        // backstop.
        (req as { destroy?: (e?: Error) => void }).destroy?.();
        clearDeadline();
        reject(makeCancelledError(method, url));
      };
      abortSignal.addEventListener("abort", onAbort, { once: true });
    }

    req.on("error", (e) => {
      clearDeadline();
      reject(e);
    });
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
  // A supplied baseUrl must NOT inherit the US default. LEADBAY_BASE_URL is the
  // documented staging/dev escape hatch and is routinely set WITHOUT
  // LEADBAY_REGION (bin.ts: "If the user pinned a baseUrl or region, honor it
  // exactly"), so defaulting to "us" here labelled every custom endpoint a US
  // tenant. That is not cosmetic: the single-country guard reads client.region
  // to decide whether a country is this workspace's own, so a French staging
  // backend reported France as a FOREIGN country and told the user it holds no
  // French leads (product#3951).
  //
  // Passing region undefined lets the constructor derive it — known regional
  // URLs still map to "us"/"fr", anything else becomes "custom", which is the
  // honest answer when nobody pinned one. setBaseUrl() already derives this way.
  const region = config.baseUrl ? config.region : (config.region ?? "us");
  const baseUrl = config.baseUrl ?? REGIONS[region ?? "us"];
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
  // Monotonic sequence bumped whenever the telemetry preference is decided by a
  // fresher signal — an explicit stamp (setCachedTelemetryEnabled) or the START
  // of a telemetry read (resolveMe / fetchTelemetryEnabled). A read snapshots it
  // and only writes telemetryEnabledCache if the sequence is UNCHANGED when it
  // completes, so (a) a stamp landing mid-read wins over the stale read and (b)
  // an older overlapping read that resolves last can't clobber a newer read's
  // value (product#3879, Codex P1).
  private telemetryStateSeq = 0;
  // The telemetry preference lives in its OWN field, separate from mePayload,
  // so it survives invalidateMe() (Codex P1). Otherwise a leadbay_set_telemetry
  // disable would be forgotten the moment the very next same-session tool
  // invalidates the /me cache (refine_prompt, my_lenses, set_active_lens, …),
  // dropping cachedTelemetryEnabled() back to undefined and letting the hosted
  // suppression predicate fall through to a stale "enabled". undefined = never
  // observed; the last read/stamp always wins and persists across /me churn.
  private telemetryEnabledCache: boolean | undefined = undefined;
  // True when telemetryEnabledCache came from an EXPLICIT user stamp
  // (leadbay_set_telemetry via setCachedTelemetryEnabled), as opposed to a
  // /users/me read. A stamp is the user's direct choice for THIS request and is
  // the single most authoritative signal — it outranks even a fail-closed
  // verdict from a timed-out/errored read, so a same-request opt-IN takes effect
  // even when a background refresh just failed closed (Codex P2). Reset to false
  // whenever a read writes the cache or the tenant switches.
  private telemetryEnabledFromStamp = false;
  // Counts explicit user stamps only. Unlike telemetryStateSeq, read-starts do
  // not move it, so callers can distinguish "a same-message stamp happened" from
  // "a background refresh merely started" when demoting stale opt-in stamps.
  private telemetryStampStateSeq = 0;
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

  /**
   * Derive the region from a base URL, comparing the NORMALIZED form.
   *
   * The trailing slash matters: `LEADBAY_BASE_URL=https://api-fr.leadbay.app/`
   * is an ordinary way to spell an env var, and comparing it raw labelled that
   * tenant "custom". Since createClient stopped forcing "us" onto a supplied
   * baseUrl, that mislabel reaches the single-country guard, which then reports
   * country_indeterminate instead of correctly classifying France as this
   * workspace's own country (product#3951).
   */
  private static regionFromBaseUrl(baseUrl: string): "us" | "fr" | "custom" {
    const normalized = baseUrl.replace(/\/+$/, "");
    if (normalized === REGIONS.us.replace(/\/+$/, "")) return "us";
    if (normalized === REGIONS.fr.replace(/\/+$/, "")) return "fr";
    return "custom";
  }

  constructor(baseUrl: string | { baseUrl: string; bearer?: string; region?: "us" | "fr" }, token?: string, region?: "us" | "fr") {
    if (typeof baseUrl === "object") {
      const opts = baseUrl;
      this._baseUrl = opts.baseUrl.replace(/\/+$/, "");
      this.token = opts.bearer ?? null;
      this._region = opts.region ?? LeadbayClient.regionFromBaseUrl(opts.baseUrl);
    } else {
      this._baseUrl = baseUrl.replace(/\/+$/, "");
      this.token = token ?? null;
      this._region = region ?? LeadbayClient.regionFromBaseUrl(baseUrl);
    }
  }

  /**
   * Whether this client may compose text that promotes a purchase. Default
   * true. The MCP server sets it false for a host whose directory forbids
   * promoting upgrades (see BuildServerOptions.includeCommerce); the only
   * effect is that the QUOTA_EXCEEDED hint drops its two selling sentences.
   * Set per client, and the hosted server builds one client per session, so
   * this never leaks across tenants.
   */
  commerce = true;

  get baseUrl(): string {
    return this._baseUrl;
  }

  get region(): "us" | "fr" | "custom" {
    return this._region;
  }

  get lastMeta(): RequestMeta | null {
    return this._lastMeta;
  }

  private clearTenantScopedCaches(): void {
    this.defaultLensId = null;
    this.defaultLensCachedAt = null;
    this.mePayload = null;
    this.mePayloadCachedAt = null;
    this.tasteProfile = null;
    this.tasteProfileCachedAt = null;
    // The telemetry preference is tenant-scoped too (Codex P2). Clearing it —
    // and bumping the sequence so any /users/me read still in flight from the
    // OLD tenant can't write the new tenant's cache — prevents the previous
    // account's opt-out from wrongly suppressing the new one (e.g. after
    // leadbay_login switches region or replaces the token).
    this.telemetryEnabledCache = undefined;
    this.telemetryEnabledFromStamp = false;
    this.telemetryStateSeq++;
    this.telemetryStampStateSeq++;
  }

  // Used by login when region auto-detect picks a different backend than the
  // one the client was constructed with.
  setBaseUrl(baseUrl: string, region?: "us" | "fr"): void {
    this._baseUrl = baseUrl.replace(/\/+$/, "");
    this._region = region ?? LeadbayClient.regionFromBaseUrl(baseUrl);
    // Region change invalidates everything — different tenant.
    this.clearTenantScopedCaches();
  }

  setToken(token: string): void {
    this.token = token;
    // Token replacement can be a same-region account switch (leadbay_login only
    // calls setBaseUrl when region changes). Clear tenant-scoped state here too.
    this.clearTenantScopedCaches();
  }

  get isAuthenticated(): boolean {
    return this.token !== null;
  }

  // Test-only getter for concurrency assertions
  get _semaphoreState(): { active: number; queued: number } {
    return { active: this.activeRequests, queued: this.waitQueue.length };
  }

  // `signal` makes a QUEUED acquisition abortable. Without it a cancelled call
  // that arrived when all MAX_CONCURRENT slots were busy could not observe the
  // abort until an unrelated request finished — the signal was only forwarded
  // to the socket, which this call had not reached yet. Against slow or stalled
  // peers that stranded the caller well past the <=2s exit the delivery tools
  // advertise.
  // `deadlineAt` is an ABSOLUTE epoch-ms bound covering the queue wait itself.
  // Without it a bounded call could still be stranded here without limit: the
  // deadline was only handed to httpsRequest, which does not start until this
  // resolves, so five slow peers let even `wait_seconds: 1` run unbounded. The
  // wait a caller asked for is wall-clock, not socket time.
  private async acquireSemaphore(
    signal?: AbortSignal,
    deadlineAt?: number
  ): Promise<void> {
    if (signal?.aborted) throw this.cancelledBeforeSendError();
    if (deadlineAt !== undefined && Date.now() >= deadlineAt) {
      throw timeoutError("Request deadline expired before a request slot was free");
    }
    if (this.activeRequests < MAX_CONCURRENT) {
      this.activeRequests++;
      return;
    }
    return new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const waiter = () => {
        cleanup();
        this.activeRequests++;
        resolve();
      };
      // SPLICE the waiter out rather than flagging it dead: releaseSemaphore()
      // shifts the queue blindly, so a tombstoned waiter would still take the
      // ++ and resolve nothing — leaking one slot per abandonment until the
      // client can serve no requests at all.
      const drop = () => {
        const i = this.waitQueue.indexOf(waiter);
        if (i !== -1) this.waitQueue.splice(i, 1);
        cleanup();
      };
      const onAbort = () => {
        drop();
        reject(this.cancelledBeforeSendError());
      };
      const onDeadline = () => {
        drop();
        reject(
          timeoutError("Request deadline expired while queued for a request slot")
        );
      };
      const cleanup = () => {
        signal?.removeEventListener("abort", onAbort);
        if (timer !== undefined) clearTimeout(timer);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      if (deadlineAt !== undefined) {
        timer = setTimeout(onDeadline, Math.max(deadlineAt - Date.now(), 0));
        // Never hold the process open on a queue deadline.
        (timer as unknown as { unref?: () => void }).unref?.();
      }
      this.waitQueue.push(waiter);
    });
  }

  // Cancelled while queued — nothing was ever put on the wire, which is what
  // makes this safe to report as "not sent" even for a write.
  private cancelledBeforeSendError(): LeadbayError {
    return this.makeError(
      "REQUEST_CANCELLED",
      "The request was cancelled before it was sent.",
      "Re-call the tool if you still want the result — nothing reached the API, so nothing was charged."
    );
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
  // as a bare reference (see request()'s ternary). Retries are GET-ONLY (see
  // retriesOn401): a 401 on a write (POST/PUT/DELETE) may arrive AFTER the
  // mutation already committed server-side, so blindly re-sending it would
  // double-execute the write. Reads are idempotent, so retrying them is safe.
  // The 250ms backoff releases the concurrency slot first (release → sleep →
  // re-acquire) so a wave of 401s doesn't pin all MAX_CONCURRENT slots in
  // setTimeout and stall the queue.
  private httpsRequestWithRetry = async (
    method: string,
    url: string,
    headers: Record<string, string>,
    body?: string | Buffer,
    timeoutMs?: number,
    signal?: AbortSignal,
    // Slot-ownership box shared with the caller. The 401 path is the only place
    // that hands the semaphore slot back mid-request, so it is the only place
    // where "does this call still hold a slot?" can stop being a constant. A
    // caller that passes the box gets an ABORTABLE re-acquisition, because the
    // box tells its `finally` whether there is anything to release; a caller
    // that omits it keeps the unconditional re-acquire, which is what preserves
    // the balance for the paths that do not track ownership.
    held?: { value: boolean },
    // Absolute ceiling for the WHOLE call — every phase, retry included. It is
    // separate from `timeoutMs` because the two answer different questions:
    // `timeoutMs` bounds one attempt (what the hosted auth probe needs, since
    // its 250ms 401-backoff outlasts a 200ms probe budget), while this bounds
    // what the caller waits in total (what a job snapshot needs, since a 401
    // must not buy the poll a second full wait_seconds). A caller may set
    // either, both, or neither.
    totalDeadlineAt?: number
  ): Promise<HttpResult> => {
    // Budget for a phase starting NOW: the earlier of "one more attempt" and
    // "what is left of the whole call".
    //
    // Two different things look like a non-positive number here and they must
    // not be conflated. An explicit `timeoutMs <= 0` is the caller OPTING OUT
    // of a per-attempt bound, so it is forwarded as-is — httpsRequest disarms
    // on `deadlineMs > 0`, and returning `undefined` instead would hand the
    // request the DEFAULT deadline, which is the opposite of what was asked.
    // A budget that started positive and has since run out is a real expiry,
    // and throws rather than returning 0 — passing a spent budget through
    // would silently restore unbounded behaviour.
    const perAttemptOptOut = timeoutMs !== undefined && timeoutMs <= 0;
    const phaseBudget = (): number | undefined => {
      const now = Date.now();
      const perAttempt =
        timeoutMs !== undefined && !perAttemptOptOut ? now + timeoutMs : undefined;
      const deadline =
        totalDeadlineAt === undefined
          ? perAttempt
          : perAttempt === undefined
          ? totalDeadlineAt
          : Math.min(perAttempt, totalDeadlineAt);
      // Opted out of BOTH bounds — forward the opt-out, not `undefined`.
      if (deadline === undefined) return perAttemptOptOut ? timeoutMs : undefined;
      const left = deadline - now;
      if (left <= 0) throw timeoutError(`Request deadline expired: ${method} ${url}`);
      return left;
    };
    // Semaphore deadline, so the opt-out must NOT become `Date.now()`, which
    // would read as "already expired" instead of "no bound".
    const phaseDeadline = (): number | undefined => {
      const b = phaseBudget();
      if (b === undefined || b <= 0) return undefined;
      return Date.now() + b;
    };
    const res = await httpsRequest(method, url, headers, body, phaseBudget(), signal);
    if (res.status === 401 && retriesOn401(method)) {
      // Check BEFORE letting go of the slot: an already-cancelled call that
      // releases here has to re-queue behind every other waiter just to hand
      // the slot straight back, which is the unbounded wait this whole path
      // is trying to avoid.
      if (signal?.aborted) return res;
      this.releaseSemaphore();
      if (held) held.value = false;
      try {
        // Abort-aware so a cancel landing mid-backoff doesn't sit out the full
        // 250ms before anyone notices.
        await new Promise<void>((resolve) => {
          const t = setTimeout(done, 250);
          function done() {
            clearTimeout(t);
            signal?.removeEventListener("abort", done);
            resolve();
          }
          signal?.addEventListener("abort", done, { once: true });
        });
      } finally {
        // Abortable ONLY when the caller tracks ownership. Otherwise a throw
        // here would leave that caller's `finally` decrementing a slot it never
        // obtained, drifting the counter permanently — so those paths keep the
        // unconditional re-acquire instead.
        // Measured from HERE — after the backoff, not before it. A per-attempt
        // window that started before the 250ms sleep would already be spent,
        // deleting the retry rather than bounding it. The total ceiling still
        // applies on top, so a caller that asked for a hard total gets one.
        await this.acquireSemaphore(held ? signal : undefined, phaseDeadline());
        if (held) held.value = true;
      }
      // Don't burn the retry on a call cancelled during the backoff: the caller
      // is gone, and the retry would only make the wait longer.
      if (signal?.aborted) return res;
      return httpsRequest(method, url, headers, body, phaseBudget(), signal);
    }
    return res;
  };

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    // `timeoutMs` bounds a single ATTEMPT (each retry gets its own window) and
    // surfaces as a `TIMEOUT`-coded Error — never an auth code, so a caller that
    // classifies failures reads it as a transient fault.
    //
    // `totalTimeoutMs` bounds the WHOLE call — queue wait, socket, 401 backoff
    // and retry together. Callers whose own contract is a total (a job poll
    // spending what is left of wait_seconds) pass this; callers that want each
    // attempt to get a fair shot (the auth probe, whose backoff outlasts its
    // per-attempt budget) pass timeoutMs. Setting both enforces both.
    //
    // Two cancellation scopes, because a paid POST needs half of one:
    //   `signal`        — full cancellation. Aborts the queue wait AND the
    //                     in-flight socket. Right for reads.
    //   `preSendSignal` — cancels ONLY up to the moment of dispatch. Aborts the
    //                     queue wait, but once the request is on the wire it is
    //                     left to finish. Right for a paid submit: while queued
    //                     nothing has been sent so cancelling is free and
    //                     honest, but tearing down an in-flight POST leaves the
    //                     caller unable to say whether the backend already
    //                     committed and charged for it.
    opts?: {
      retryOn401?: boolean;
      timeoutMs?: number;
      totalTimeoutMs?: number;
      signal?: AbortSignal;
      preSendSignal?: AbortSignal;
    }
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
    // Did a 401 on this call actually get auto-retried? Feeds the error hint.
    const retriedOn401 = retryOn401 && retriesOn401(method);
    // Pass the signal: a cancel that lands while this call is QUEUED must not
    // wait on unrelated in-flight requests to drain first. A pre-send-only
    // signal governs the queue wait too — that phase is exactly what it covers.
    const held = { value: true };
    // Start the clock BEFORE queueing: time spent waiting for a slot is time the
    // caller waited, so both bounds must already be running here.
    const startedAt = Date.now();
    const totalDeadlineAt =
      opts?.totalTimeoutMs !== undefined
        ? startedAt + opts.totalTimeoutMs
        : undefined;
    // An explicit `timeoutMs <= 0` opts OUT of a per-attempt bound; it is not a
    // budget that has run out. Only the second of those may throw.
    const perAttemptOptOut = opts?.timeoutMs !== undefined && opts.timeoutMs <= 0;
    const phaseDeadlineAt = (): number | undefined => {
      const now = Date.now();
      const perAttempt =
        opts?.timeoutMs !== undefined && !perAttemptOptOut
          ? now + opts.timeoutMs
          : undefined;
      if (totalDeadlineAt === undefined) return perAttempt;
      if (perAttempt === undefined) return totalDeadlineAt;
      return Math.min(perAttempt, totalDeadlineAt);
    };
    const remainingBudget = (): number | undefined => {
      const deadline = phaseDeadlineAt();
      // Opted out with no total on top — forward the opt-out value so
      // httpsRequest disarms. `undefined` would apply the DEFAULT deadline,
      // which is the opposite of what the caller asked for.
      if (deadline === undefined) return perAttemptOptOut ? opts?.timeoutMs : undefined;
      const left = deadline - Date.now();
      // Never hand back 0 for a budget that really did expire: httpsRequest
      // reads a non-positive timeout as "no deadline at all", which would turn
      // an exhausted budget into an unbounded request.
      if (left <= 0) throw timeoutError(`Request deadline expired: ${method} ${path}`);
      return left;
    };
    await this.acquireSemaphore(
      opts?.signal ?? opts?.preSendSignal,
      phaseDeadlineAt()
    );
    try {
      // Last point at which "nothing has been sent" is still true. A submit
      // cancelled here provably spent nothing; one cancelled a line later
      // provably nothing — which is exactly why it is allowed to finish.
      if (opts?.preSendSignal?.aborted) throw this.cancelledBeforeSendError();
      const url = `${this._baseUrl}${API_PREFIX}${path}`;
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.token}`,
      };
      if (body) {
        headers["Content-Type"] = "application/json";
      }

      const payload = body ? JSON.stringify(body) : undefined;
      // Spelled out rather than a ternary over the two functions: only the
      // retrying variant takes the ownership box, so their arities differ.
      const res = retryOn401
        ? await this.httpsRequestWithRetry(
            method,
            url,
            headers,
            payload,
            opts?.timeoutMs,
            opts?.signal,
            held,
            totalDeadlineAt
          )
        : await httpsRequest(
            method,
            url,
            headers,
            payload,
            // What is LEFT after queueing, not the original budget — otherwise
            // the queue wait and the socket wait each get the full allowance.
            remainingBudget(),
            opts?.signal
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
        throw this.mapErrorResponse(res.status, res.body, path, res.headers, retriedOn401);
      }

      return JSON.parse(res.body) as T;
    } catch (e) {
      throw this.mapTransportError(e, `${method} ${path}`);
    } finally {
      // Only if we still hold one: the 401 path can hand the slot back and then
      // fail to re-acquire on abort, and releasing unconditionally there would
      // decrement a slot this call no longer owns.
      if (held.value) this.releaseSemaphore();
    }
  }

  async requestVoid(method: string, path: string, body?: unknown): Promise<void> {
    const retriedOn401 = retriesOn401(method);
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
        throw this.mapErrorResponse(res.status, res.body, path, res.headers, retriedOn401);
      }
    } catch (e) {
      throw this.mapTransportError(e, `${method} ${path}`);
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
    const retriedOn401 = retriesOn401(method);
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
        throw this.mapErrorResponse(res.status, res.body, path, res.headers, retriedOn401);
      }

      return JSON.parse(res.body) as T;
    } catch (e) {
      throw this.mapTransportError(e, `${method} ${path}`);
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

  /**
   * Turn httpsRequest's raw TIMEOUT rejection into the `{error:true, code, …}`
   * envelope every other failure already speaks, so the agent gets something it
   * can read out to the user and act on rather than a bare Error string. Any
   * other rejection (ECONNRESET, DNS, a mapped 4xx/5xx) passes through untouched
   * — this is a translation, not a catch-all.
   *
   * The code stays "TIMEOUT" so the hosted auth probe's existing branch
   * (auth-http.ts) keeps classifying it as a transient fault and moves to the
   * sibling region instead of declaring a live token expired.
   */
  private mapTransportError(e: unknown, endpoint: string): unknown {
    const err = e as { code?: string; timeout_ms?: number } | null;
    if (err?.code !== "TIMEOUT") return e;
    const ms = err.timeout_ms ?? defaultTimeoutMs();
    const envelope = this.makeError(
      "TIMEOUT",
      `Leadbay did not respond within ${ms}ms — the request was cancelled`,
      "The connection was accepted but no response came back, so this is a Leadbay-side stall, not a bad request. It is transient: retry the same call once. If it times out again, tell the user Leadbay is not responding right now and offer to report it with leadbay_report_friction.",
      endpoint
    );
    if (envelope._meta) {
      envelope._meta.timeout_ms = ms;
      // makeError fills latency_ms from _lastMeta, which for a timeout is a
      // PREVIOUS request's latency — a number Sentry would show next to this
      // failure as if it described it. The request ran for the deadline.
      envelope._meta.latency_ms = ms;
    }
    return envelope;
  }

  private mapErrorResponse(
    status: number,
    rawBody: string,
    endpoint: string,
    headers: Record<string, string | string[] | undefined>,
    retried: boolean
  ): LeadbayError {
    let parsed: any;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      parsed = null;
    }

    const retryAfter = parseRetryAfter(headers["retry-after"]);

    if (status === 401) {
      // Leadbay tokens don't expire on a timer, so the one thing we can state
      // for certain is that the token did NOT time out. A 401 is EITHER a
      // Leadbay-side hiccup OR a genuine logout/revocation (per Milan, a 401 can
      // mean the user is logged out) — we can't tell which from here, so name
      // both causes and assert neither. Don't claim the login is fine, and don't
      // push re-login as the default fix either.
      //
      // [retried] says whether the auto-retry actually ran — false on a write
      // (retriesOn401) and also on a GET whose caller passed retryOn401:false,
      // e.g. the startup auth probe. The hint states only that fact and not the
      // reason, so it can't misdescribe either path: it used to claim a retry
      // that never happened, which read as "we already tried twice, it's
      // hopeless" on a call attempted exactly once (product#3998).
      // (Code stays AUTH_EXPIRED for backward compat with the MCP auth handlers.)
      return this.makeError(
        "AUTH_EXPIRED",
        "Leadbay rejected this request (401)",
        retried
          ? "Tokens don't expire on a timer, so this isn't stale. Already auto-retried once and it 401'd again — usually a Leadbay-side hiccup, but can also mean the user logged out. Try again shortly, else report it."
          : "Tokens don't expire on a timer, so this isn't stale. This call wasn't auto-retried, so it's the first attempt — a Leadbay-side hiccup, or the user logged out. Try again once, else report it.",
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
        //
        // The two selling sentences are dropped when `commerce` is off — this
        // hint is text the agent reads out, and a host may forbid promoting a
        // purchase. Nothing is reworded; the rest of the hint is unchanged, and
        // "the user topped up (elsewhere), so retry" survives either way.
        `${hintBase}` +
          (this.commerce
            ? `, OR top up AI credits — top-ups clear the throttle immediately. ` +
              `Offer the user to generate a Stripe checkout URL via leadbay_create_topup_link, OR direct them to app.leadbay.ai → Billing. `
            : `. `) +
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
  //
  // `opts.timeoutMs` bounds each underlying attempt and CANCELS it. Callers that
  // give up on this read with their own `Promise.race` must pass it: abandoning
  // the promise doesn't stop the request, so against a silent backend (handshake
  // completes, nothing ever comes back) the socket and its API-semaphore slot
  // stay held for the life of the process. Racing bounds the caller's wait; only
  // the deadline bounds the resource.
  async resolveMe(force = false, opts?: { timeoutMs?: number }): Promise<UserMePayload> {
    const now = Date.now();
    if (
      !force &&
      this.mePayload !== null &&
      this.mePayloadCachedAt !== null &&
      now - this.mePayloadCachedAt < ME_CACHE_TTL_MS
    ) {
      return this.mePayload;
    }
    // Claim a sequence for THIS read; only write the telemetry cache from its
    // result if nothing fresher (a stamp or a newer read) moved the sequence
    // meanwhile (Codex P1). An absent telemetry_enabled (older backend) never
    // writes — cachedTelemetryEnabled() stays undefined and the caller's
    // fallback (resolve verdict / session flag) governs.
    const seqAtStart = ++this.telemetryStateSeq;
    const me = await this.request<UserMePayload>("GET", "/users/me", undefined, {
      timeoutMs: opts?.timeoutMs,
    });
    this.mePayload = me;
    this.mePayloadCachedAt = now;
    if (this.telemetryStateSeq === seqAtStart && me.telemetry_enabled !== undefined) {
      this.telemetryEnabledCache = me.telemetry_enabled;
      this.telemetryEnabledFromStamp = false; // value came from a read, not a stamp
    }
    return me;
  }

  // Lightweight cross-session telemetry-preference read for the hosted SSE
  // per-message refresh (product#3879, Codex P2). UNLIKE resolveMe() this does
  // NOT touch mePayload / the general /me cache — so a slow background refresh
  // can never repopulate a stale last_requested_lens over a tool's mutation, and
  // it never serves the 60s /me cache (always a fresh read). It reads the SAME
  // /users/me endpoint (telemetry_enabled lives there) but only reconciles the
  // dedicated telemetry field, under the same sequence guard as resolveMe.
  //
  // It deliberately bypasses request() and therefore never writes _lastMeta
  // (Codex P2): the refresh shares the tool's client, and request() rewrites
  // _lastMeta on every call. Without isolation, a refresh completing between a
  // tool's real backend call and that tool copying client.lastMeta into its
  // result (e.g. pull-leads' _meta.latency_ms) could make the metadata describe
  // GET /users/me instead of the tool call.
  //
  // Returns the observed preference: true/false, or undefined when the backend
  // omitted the field (older backend → caller treats as enabled default).
  //
  // `opts.timeoutMs` bounds and CANCELS each attempt — same reasoning as
  // resolveMe(): the hosted SSE refresh fires this off behind its own timer and
  // stops waiting, so without a deadline a dark region leaves the request (and
  // the semaphore slot the caller is explicitly waiting on) held forever.
  async fetchTelemetryEnabled(opts?: { timeoutMs?: number }): Promise<boolean | undefined> {
    const seqAtStart = ++this.telemetryStateSeq;
    if (process.env.LEADBAY_MOCK === "1") {
      const metaBefore = this._lastMeta;
      try {
        const me = this.mockRequest<UserMePayload>("GET", "/users/me");
        const observed = me.telemetry_enabled;
        if (this.telemetryStateSeq === seqAtStart && observed !== undefined) {
          this.telemetryEnabledCache = observed;
          this.telemetryEnabledFromStamp = false;
        }
        return observed;
      } finally {
        // Keep the telemetry-only refresh invisible to tool-visible metadata,
        // matching the live path that bypasses request().
        this._lastMeta = metaBefore;
      }
    }
    if (!this.token) {
      throw this.makeError(
        "NOT_AUTHENTICATED",
        "Not logged in to Leadbay",
        "Set LEADBAY_TOKEN in your MCP client config, or run: npx -y -p @leadbay/mcp@latest installer",
        "/users/me"
      );
    }
    await this.acquireSemaphore();
    try {
      const res = await this.httpsRequestWithRetry(
        "GET",
        `${this._baseUrl}${API_PREFIX}/users/me`,
        { Authorization: `Bearer ${this.token}` },
        undefined,
        opts?.timeoutMs
      );
      if (res.status < 200 || res.status >= 300) {
        // Hardcoded GET through httpsRequestWithRetry, so the 401 auto-retry ran.
        throw this.mapErrorResponse(res.status, res.body, "/users/me", res.headers, retriesOn401("GET"));
      }
      const me = JSON.parse(res.body) as UserMePayload;
      const observed = me.telemetry_enabled;
      if (this.telemetryStateSeq === seqAtStart && observed !== undefined) {
        this.telemetryEnabledCache = observed;
        this.telemetryEnabledFromStamp = false; // value came from a read, not a stamp
      }
      return observed;
    } catch (e) {
      throw this.mapTransportError(e, "GET /users/me");
    } finally {
      this.releaseSemaphore();
    }
  }

  // Force re-fetch on next resolveMe(). Call from any tool that mutates a
  // /me-cached field (last_requested_lens, billing, etc.). Deliberately does
  // NOT clear telemetryEnabledCache — the opt-out preference is orthogonal to
  // /me staleness and must survive invalidation (Codex P1).
  invalidateMe(): void {
    this.mePayload = null;
    this.mePayloadCachedAt = null;
  }

  // Warm the /users/me cache from a payload the caller already fetched, so the
  // next resolveMe() is a cache hit (no extra round trip). Used by the hosted
  // HTTP auth probe: it validates the token with a fail-fast /users/me request
  // and seeds the result here, so the telemetry path's resolveMe() reuses it.
  seedMe(me: UserMePayload): void {
    this.mePayload = me;
    this.mePayloadCachedAt = Date.now();
  }

  // Synchronous read of the last-cached telemetry preference, without a fetch.
  // Returns undefined when /users/me hasn't been resolved (or was invalidated).
  // The hosted telemetry suppression predicate reads this AT CAPTURE TIME so a
  // leadbay_set_telemetry disable within the same request suppresses that very
  // request's tracking — the opt-out action isn't itself the last tracked event
  // (product#3879). resolveMe() keeps mePayload populated after a write, so this
  // reflects the post-write state.
  cachedTelemetryEnabled(): boolean | undefined {
    return this.telemetryEnabledCache;
  }

  // True when the cached preference came from an explicit user stamp (a
  // leadbay_set_telemetry toggle), not a read. The hosted suppression predicate
  // treats a stamp as the single most-authoritative signal — it outranks a
  // fail-closed verdict from a failed background read, so a same-request opt-IN
  // takes effect even when a refresh just timed out (product#3879, Codex P2).
  cachedTelemetryStamped(): boolean {
    return this.telemetryEnabledFromStamp && this.telemetryEnabledCache !== undefined;
  }

  // Monotonic sequence exposed so callers can tell whether a telemetry stamp
  // happened AFTER a reference point (e.g. an SSE message start). Bumped by every
  // stamp and every telemetry read-start; see telemetryStateSeq.
  telemetrySeq(): number {
    return this.telemetryStateSeq;
  }

  // Monotonic sequence moved only by explicit user stamps. Used by the SSE
  // refresh failure path to demote stale opt-in stamps without mistaking a
  // read-start sequence bump for a same-message opt-in.
  telemetryStampSeq(): number {
    return this.telemetryStampStateSeq;
  }

  // Demote the cached preference from "explicit stamp" to ordinary read-level
  // authority WITHOUT changing its value. A stamp is scoped to the request that
  // made it (Codex P2): once a LATER SSE message's refresh produces a
  // fail-closed verdict (timeout/error), that earlier stamp must no longer
  // outrank it, or a session that once enabled would keep emitting through every
  // subsequent unreadable refresh.
  //
  // `onlyIfStampSeqAtMost` guards against demoting a stamp made by the CURRENT
  // message (Codex P2): pass the STAMP sequence captured at message start; if a
  // stamp has bumped it beyond the snapshot, that stamp is same-message (a fresh
  // opt-in) and must be preserved. Read-starts do not affect this guard.
  clearTelemetryStampOrigin(onlyIfStampSeqAtMost?: number): void {
    if (
      onlyIfStampSeqAtMost !== undefined &&
      this.telemetryStampStateSeq > onlyIfStampSeqAtMost
    ) {
      return; // a stamp landed after the reference point → same-message, keep it
    }
    this.telemetryEnabledFromStamp = false;
  }

  // Deterministically stamp the cached telemetry preference to a known value,
  // WITHOUT a fetch. leadbay_set_telemetry calls this right after a successful
  // POST /users/telemetry so the suppression predicate reflects the new state
  // even if the follow-up refresh fails (product#3879) — a disable must never
  // fail open and let the opt-out request emit error telemetry. Creates a
  // minimal cache entry if /users/me was never resolved.
  setCachedTelemetryEnabled(enabled: boolean): void {
    // Bump the sequence so any /users/me read currently in flight will refuse
    // to overwrite this stamp when it resolves (Codex P1).
    this.telemetryStateSeq++;
    this.telemetryStampStateSeq++;
    // The durable field is the source of truth cachedTelemetryEnabled() reads;
    // it survives invalidateMe() so the opt-out isn't forgotten when the next
    // tool churns the /me cache (Codex P1). Mark it as stamp-sourced so the
    // predicate lets this explicit user choice outrank a fail-closed verdict.
    this.telemetryEnabledCache = enabled;
    this.telemetryEnabledFromStamp = true;
    // Keep mePayload's copy in sync when present, for any caller reading the
    // full payload directly (not load-bearing for suppression).
    if (this.mePayload) {
      this.mePayload = { ...this.mePayload, telemetry_enabled: enabled };
    }
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
