import https from "node:https";
import type {
  LeadbayError,
  LensPayload,
  UserMePayload,
  IdealBuyerProfilePayload,
  PurchaseIntentTagPayload,
  AiAgentQuestionPayload,
} from "./types.js";

const LENS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const TASTE_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_CONCURRENT = 5;

const REGIONS: Record<string, string> = {
  us: "https://api-us.leadbay.app",
  fr: "https://api-fr.leadbay.app",
};

interface HttpResult {
  status: number;
  body: string;
}

// Use node:https directly — the OpenClaw gateway patches globalThis.fetch
// which intercepts outgoing requests and causes auth failures.
function httpsRequest(
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: string
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const reqHeaders: Record<string, string | number> = { ...headers };
    if (body) {
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
          });
        });
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
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
  return new LeadbayClient(baseUrl, config.token);
}

export class LeadbayClient {
  private token: string | null;
  readonly baseUrl: string;
  private defaultLensId: number | null = null;
  private defaultLensCachedAt: number | null = null;
  private orgId: string | null = null;
  private tasteProfile: TasteProfileResult | null = null;
  private tasteProfileCachedAt: number | null = null;

  // Simple semaphore for concurrency limiting
  private activeRequests = 0;
  private waitQueue: Array<() => void> = [];

  constructor(baseUrl: string, token?: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token ?? null;
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

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.token) {
      throw this.makeError(
        "NOT_AUTHENTICATED",
        "Not logged in to Leadbay",
        "Set LEADBAY_TOKEN env var (obtain token at https://app.leadbay.ai/settings/api-tokens), or use the OpenClaw leadbay_login tool"
      );
    }
    await this.acquireSemaphore();
    try {
      const url = `${this.baseUrl}/1.5${path}`;
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

      if (res.status === 204) {
        return null as T;
      }

      if (res.status < 200 || res.status >= 300) {
        throw this.mapErrorResponse(res.status, res.body);
      }

      return JSON.parse(res.body) as T;
    } finally {
      this.releaseSemaphore();
    }
  }

  async requestVoid(method: string, path: string, body?: unknown): Promise<void> {
    if (!this.token) {
      throw this.makeError(
        "NOT_AUTHENTICATED",
        "Not logged in to Leadbay",
        "Set LEADBAY_TOKEN env var (obtain token at https://app.leadbay.ai/settings/api-tokens), or use the OpenClaw leadbay_login tool"
      );
    }
    await this.acquireSemaphore();
    try {
      const url = `${this.baseUrl}/1.5${path}`;
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

      if (res.status < 200 || res.status >= 300) {
        throw this.mapErrorResponse(res.status, res.body);
      }
    } finally {
      this.releaseSemaphore();
    }
  }

  private mapErrorResponse(status: number, rawBody: string): LeadbayError {
    let parsed: any;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      parsed = null;
    }

    if (status === 401) {
      return this.makeError(
        "AUTH_EXPIRED",
        "Authentication token expired or invalid",
        "Your LEADBAY_TOKEN is no longer valid. Regenerate at https://app.leadbay.ai/settings/api-tokens and restart."
      );
    }
    if (status === 402 || parsed?.error === "quota_exceeded") {
      return this.makeError(
        "QUOTA_EXCEEDED",
        "No enrichment credits remaining",
        "Your Leadbay account is out of credits. Purchase more at https://app.leadbay.ai"
      );
    }
    if (status === 403) {
      const msg = parsed?.message || parsed?.error || "";
      if (
        typeof msg === "string" &&
        (msg.includes("suspend") || msg.includes("billing"))
      ) {
        return this.makeError(
          "BILLING_SUSPENDED",
          "Account billing is suspended",
          "Your Leadbay account billing is suspended. Update at https://app.leadbay.ai"
        );
      }
      return this.makeError(
        "FORBIDDEN",
        "Insufficient permissions",
        "Your token does not have access to this resource. Check account permissions at https://app.leadbay.ai"
      );
    }
    if (status === 404) {
      return this.makeError(
        "NOT_FOUND",
        parsed?.message || "Resource not found",
        "Verify the ID is correct"
      );
    }
    if (status === 429) {
      return this.makeError(
        "RATE_LIMITED",
        "Too many requests",
        "Wait a moment and try again"
      );
    }
    return this.makeError(
      "API_ERROR",
      parsed?.message || `API error (${status})`,
      "Try again or check the Leadbay API status"
    );
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

    const lenses = await this.request<LensPayload[]>("GET", "/lenses");

    const active = lenses.find((l) => l.is_last_active);
    const fallback = active || lenses.find((l) => l.is_default) || lenses[0];

    if (!fallback) {
      throw this.makeError(
        "NO_LENS",
        "No lenses found on your account",
        "Create a lens in the Leadbay app first"
      );
    }

    this.defaultLensId = fallback.id;
    this.defaultLensCachedAt = now;
    return this.defaultLensId;
  }

  async resolveOrgId(): Promise<string> {
    if (this.orgId !== null) {
      return this.orgId;
    }

    const me = await this.request<UserMePayload>("GET", "/users/me");
    this.orgId = me.organization.id;
    return this.orgId;
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

  async prefetchOrgData(): Promise<void> {
    await this.resolveOrgId();
    await this.resolveTasteProfile();
  }

  makeError(code: string, message: string, hint: string): LeadbayError {
    return { error: true, code, message, hint };
  }
}

export { REGIONS };
