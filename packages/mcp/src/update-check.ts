// Auto-update check — GitHub Releases polling + in-process cache.
//
// Fired twice in the lifecycle: once at process boot (bin.ts) so we
// pick up a release within seconds of the user opening Claude Desktop
// for the first time post-publish, AND fire-and-forget on EVERY tool
// call (server.ts CallTool handler) so a long-running MCP process
// (Claude Desktop kept open for days, never restarted) still picks up
// new releases.
//
// Flow each invocation:
//   1. read UpdateState from ~/.leadbay/update-state.json
//   2. if last_check_time < 24h ago AND we already know latest_version,
//      seed the in-memory cache from state and skip the HTTP hop
//   3. otherwise: GET api.github.com/repos/leadbay/leadclaw/releases/latest
//      with If-None-Match: <state.etag> if present
//      - 304: refresh last_check_time, keep latest_known_*
//      - 200: parse tag_name → strip "mcp-v" prefix → semver compare
//              against currentVersion, persist if newer, update cache
//   4. emit `mcp_update_check` PostHog event either way (with check_error
//      on the failure path)
//
// The cached UpdateInfo is exposed via getCachedUpdateInfo() which the
// server.ts response wrapper consults when leadbay_account_status is
// called. We do NOT block tool calls on this check — it runs out-of-band
// via an in-flight guard so concurrent tool calls don't race the fetch.

import type { ToolLogger } from "@leadbay/core";
import type { UpdateStateStore } from "./update-state.js";
import type { TelemetryHandle } from "./telemetry.js";

export interface UpdateInfo {
  current_version: string;
  latest_version: string;
  /** Direct download URL for the .mcpb asset (Claude Desktop installer). */
  mcpb_url: string;
  /** GitHub release page (changelog). */
  release_url: string;
}

let cachedInfo: UpdateInfo | null = null;
// Guards against concurrent fetches. When many tool calls land within
// the same second, all of them see "stale" — without this gate they'd
// all kick off a GitHub fetch in parallel. With the gate, the first
// call fires; the rest skip silently.
let checkInFlight = false;

export function getCachedUpdateInfo(): UpdateInfo | null {
  return cachedInfo;
}

/** Test-only — reset the module singleton between test cases. */
export function __resetUpdateCacheForTests(): void {
  cachedInfo = null;
  checkInFlight = false;
}

const RELEASES_LATEST_URL =
  "https://api.github.com/repos/leadbay/leadclaw/releases/latest";
// Once-per-day cadence. The MCP process can live for weeks in Claude
// Desktop (single boot, many chats), so a 1h throttle would be too
// aggressive in steady-state and a 1h re-check window from boot
// wouldn't matter at all. 24h is the right granularity for "did a new
// release land" — releases ship at most a few times a month.
const CHECK_THROTTLE_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;
const USER_AGENT = "leadbay-mcp-update-check";
// tsup --define wires this at build time; vitest.config.ts mirrors it.
declare const __LEADBAY_MCP_VERSION__: string;

// Strip our release-tag prefix conventions: "mcp-v0.10.1" / "v0.10.1" / "0.10.1".
export function parseTagName(tag: string): string | null {
  const stripped = tag.replace(/^mcp-v?/, "").replace(/^v/, "");
  // Must look like semver "MAJOR.MINOR.PATCH" with optional prerelease/build.
  if (!/^\d+\.\d+\.\d+/.test(stripped)) return null;
  return stripped;
}

// Returns 1 if a > b, -1 if a < b, 0 if equal. Handles core + prerelease only
// (no build metadata; the package never publishes with +build tags).
//
// Prerelease semver rule (§11.4): a stable version is GREATER than the same
// core with a prerelease tag — so "0.10.1" > "0.10.1-dev.3", "0.10.2" >
// "0.10.2-rc.1". Numeric prerelease identifiers compare numerically, alpha
// identifiers compare ASCII; numeric < alpha when identifier kinds differ
// (Anthropic-Skills semver compliance baseline).
export function compareSemver(a: string, b: string): number {
  const [aCore, aPre] = a.split("-", 2);
  const [bCore, bPre] = b.split("-", 2);
  const aParts = aCore.split(".").map((n) => parseInt(n, 10));
  const bParts = bCore.split(".").map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const av = aParts[i] ?? 0;
    const bv = bParts[i] ?? 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  // Cores equal — handle prerelease ordering.
  if (!aPre && !bPre) return 0;
  if (!aPre && bPre) return 1; // stable > prerelease
  if (aPre && !bPre) return -1;
  const aIds = aPre!.split(".");
  const bIds = bPre!.split(".");
  const len = Math.max(aIds.length, bIds.length);
  for (let i = 0; i < len; i++) {
    const ai = aIds[i];
    const bi = bIds[i];
    if (ai === undefined) return -1; // fewer ids = lower
    if (bi === undefined) return 1;
    const aNum = /^\d+$/.test(ai);
    const bNum = /^\d+$/.test(bi);
    if (aNum && bNum) {
      const d = parseInt(ai, 10) - parseInt(bi, 10);
      if (d !== 0) return d > 0 ? 1 : -1;
    } else if (aNum !== bNum) {
      return aNum ? -1 : 1; // numeric < alpha
    } else if (ai !== bi) {
      return ai > bi ? 1 : -1;
    }
  }
  return 0;
}

interface GithubRelease {
  tag_name?: string;
  html_url?: string;
  assets?: Array<{ name?: string; browser_download_url?: string }>;
}

function pickMcpbAsset(rel: GithubRelease): string | undefined {
  if (!Array.isArray(rel.assets)) return undefined;
  // Prefer .mcpb; fall back to .dxt (older releases only had .dxt).
  const mcpb = rel.assets.find(
    (a) => typeof a.name === "string" && a.name.endsWith(".mcpb")
  );
  if (mcpb?.browser_download_url) return mcpb.browser_download_url;
  const dxt = rel.assets.find(
    (a) => typeof a.name === "string" && a.name.endsWith(".dxt")
  );
  return dxt?.browser_download_url;
}

export interface CheckForUpdateOpts {
  currentVersion: string;
  stateStore: UpdateStateStore;
  telemetry: TelemetryHandle;
  logger?: ToolLogger;
  now?: () => number;
  /** Test-only override of the upstream URL. */
  releasesUrl?: string;
  /** Test-only override of global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Run the check. Resolves once state is persisted and `cachedInfo` is
 * populated (or after a failure has been logged). Never throws — auto-update
 * is best-effort.
 *
 * Returns the resulting UpdateInfo (or null if no update / suppressed).
 */
export async function checkForUpdate(
  opts: CheckForUpdateOpts
): Promise<UpdateInfo | null> {
  if (checkInFlight) return cachedInfo;
  checkInFlight = true;
  try {
    return await doCheck(opts);
  } finally {
    checkInFlight = false;
  }
}

async function doCheck(opts: CheckForUpdateOpts): Promise<UpdateInfo | null> {
  const now = opts.now ?? Date.now;
  const url = opts.releasesUrl ?? RELEASES_LATEST_URL;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const currentVersion = opts.currentVersion;
  const state = await opts.stateStore.read();

  const within = now() - state.last_check_time < CHECK_THROTTLE_MS;
  if (within && state.latest_known_version && state.latest_known_mcpb_url && state.latest_known_release_url) {
    // Throttled — seed cache from disk + return.
    const cached = buildInfoIfUpgrade(
      currentVersion,
      state.latest_known_version,
      state.latest_known_mcpb_url,
      state.latest_known_release_url,
      state.suppressed_versions,
      state.remind_until,
      now()
    );
    cachedInfo = cached;
    return cached;
  }

  // Hit the wire.
  let status: number;
  let body: GithubRelease | null = null;
  let nextEtag: string | undefined;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": USER_AGENT,
          ...(state.etag ? { "If-None-Match": state.etag } : {}),
        },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    status = resp.status;
    nextEtag = resp.headers.get("etag") ?? state.etag;
    if (status === 200) {
      body = (await resp.json()) as GithubRelease;
    }
  } catch (err: any) {
    opts.logger?.warn?.(
      `update_check.fetch_failed ${err?.message ?? err}`
    );
    opts.telemetry.captureUpdateCheck?.({
      current_version: currentVersion,
      check_error: String(err?.message ?? err),
    });
    await opts.stateStore.update((cur) => ({ ...cur, last_check_time: now() }));
    return null;
  }

  if (status !== 200 && status !== 304) {
    opts.telemetry.captureUpdateCheck?.({
      current_version: currentVersion,
      check_error: `http_${status}`,
    });
    await opts.stateStore.update((cur) => ({ ...cur, last_check_time: now() }));
    return null;
  }

  let latestVersion: string | undefined;
  let mcpbUrl: string | undefined;
  let releaseUrl: string | undefined;
  if (status === 200 && body) {
    const parsed = body.tag_name ? parseTagName(body.tag_name) : null;
    if (parsed) {
      latestVersion = parsed;
      mcpbUrl = pickMcpbAsset(body);
      releaseUrl = body.html_url;
    }
  } else {
    // 304 — keep what we had on disk.
    latestVersion = state.latest_known_version;
    mcpbUrl = state.latest_known_mcpb_url;
    releaseUrl = state.latest_known_release_url;
  }

  const persisted = await opts.stateStore.update((cur) => ({
    ...cur,
    last_check_time: now(),
    etag: nextEtag,
    latest_known_version: latestVersion ?? cur.latest_known_version,
    latest_known_mcpb_url: mcpbUrl ?? cur.latest_known_mcpb_url,
    latest_known_release_url: releaseUrl ?? cur.latest_known_release_url,
  }));

  opts.telemetry.captureUpdateCheck?.({
    current_version: currentVersion,
    latest_version: persisted.latest_known_version,
  });

  const info = buildInfoIfUpgrade(
    currentVersion,
    persisted.latest_known_version,
    persisted.latest_known_mcpb_url,
    persisted.latest_known_release_url,
    persisted.suppressed_versions,
    persisted.remind_until,
    now()
  );
  cachedInfo = info;
  return info;
}

function buildInfoIfUpgrade(
  currentVersion: string,
  latestVersion: string | undefined,
  mcpbUrl: string | undefined,
  releaseUrl: string | undefined,
  suppressed: string[],
  remindUntil: number | undefined,
  nowMs: number
): UpdateInfo | null {
  if (!latestVersion || !mcpbUrl || !releaseUrl) return null;
  if (compareSemver(latestVersion, currentVersion) <= 0) return null;
  if (suppressed.includes(latestVersion)) return null;
  if (remindUntil && remindUntil > nowMs) return null;
  return {
    current_version: currentVersion,
    latest_version: latestVersion,
    mcpb_url: mcpbUrl,
    release_url: releaseUrl,
  };
}

/**
 * Detect "this boot is on a newer VERSION than the previous boot remembered"
 * — emit a `mcp_version_updated` conversion event and rewrite the
 * previous_running_version field. Called from bin.ts at startup, separately
 * from the GitHub check so it works even when offline.
 */
export async function recordRunningVersion(
  currentVersion: string,
  stateStore: UpdateStateStore,
  telemetry: TelemetryHandle
): Promise<void> {
  const cur = await stateStore.read();
  const prev = cur.previous_running_version;
  if (prev === currentVersion) return;
  if (prev && compareSemver(currentVersion, prev) > 0) {
    telemetry.captureVersionUpdated?.({
      from_version: prev,
      to_version: currentVersion,
    });
  }
  await stateStore.update((s) => ({
    ...s,
    previous_running_version: currentVersion,
    // Clear any prior "remind me tomorrow" for the version we just landed on —
    // the user has effectively answered the prompt by upgrading.
    remind_until: undefined,
    // Drop suppression of versions we've now surpassed.
    suppressed_versions: s.suppressed_versions.filter(
      (v) => compareSemver(v, currentVersion) > 0
    ),
  }));
}

export const __VERSION_FROM_BUILD__ = typeof __LEADBAY_MCP_VERSION__ === "string"
  ? __LEADBAY_MCP_VERSION__
  : "0.0.0-dev";
