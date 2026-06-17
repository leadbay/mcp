/**
 * checkForUpdate — GitHub releases polling + semver compare.
 *
 * Tests the four interesting branches:
 *   - throttle hit (last_check_time within window) → no HTTP, seeds cache from disk
 *   - 200 with newer release → cache populated, state persisted, etag captured
 *   - 304 not-modified → keeps prior latest, refreshes last_check_time
 *   - network error → silently noops + emits check_error telemetry
 *
 * Plus the suppression filters: skipped versions + remind_until window.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UpdateStateStore } from "../../src/update-state.js";
import {
  checkForUpdate,
  compareSemver,
  parseTagName,
  recordRunningVersion,
  getCachedUpdateInfo,
  __resetUpdateCacheForTests,
} from "../../src/update-check.js";
import type { TelemetryHandle } from "../../src/telemetry.js";
import { NOOP_TELEMETRY } from "../../src/telemetry.js";

function makeTelemetry(): TelemetryHandle & {
  checks: any[];
  prompted: any[];
  installed: any[];
  dismissed: any[];
  versionUpdated: any[];
} {
  const checks: any[] = [];
  const prompted: any[] = [];
  const installed: any[] = [];
  const dismissed: any[] = [];
  const versionUpdated: any[] = [];
  return {
    ...NOOP_TELEMETRY,
    captureUpdateCheck: (p) => checks.push(p),
    captureUpdatePrompted: (p) => prompted.push(p),
    captureUpdateInstallClicked: (p) => installed.push(p),
    captureUpdateDismissed: (p) => dismissed.push(p),
    captureVersionUpdated: (p) => versionUpdated.push(p),
    checks,
    prompted,
    installed,
    dismissed,
    versionUpdated,
  };
}

function fakeFetch(
  responses: Array<{ status: number; body?: object; etag?: string }>
): typeof fetch {
  let i = 0;
  return (async (_url: string, _init?: any) => {
    const r = responses[i++];
    if (!r) throw new Error("fakeFetch: no more scripted responses");
    const headers = new Headers();
    if (r.etag) headers.set("etag", r.etag);
    return {
      status: r.status,
      headers,
      json: async () => r.body ?? {},
    } as unknown as Response;
  }) as typeof fetch;
}

beforeEach(() => {
  __resetUpdateCacheForTests();
});

afterEach(() => {
  __resetUpdateCacheForTests();
});

describe("parseTagName", () => {
  it("strips mcp-v prefix", () => {
    expect(parseTagName("mcp-v0.10.1")).toBe("0.10.1");
  });
  it("strips bare v prefix", () => {
    expect(parseTagName("v1.2.3")).toBe("1.2.3");
  });
  it("accepts bare semver", () => {
    expect(parseTagName("1.2.3")).toBe("1.2.3");
  });
  it("accepts prerelease tag", () => {
    expect(parseTagName("mcp-v0.11.0-dev.4")).toBe("0.11.0-dev.4");
  });
  it("rejects non-semver", () => {
    expect(parseTagName("nightly")).toBeNull();
    expect(parseTagName("mcp-vbeta")).toBeNull();
  });
});

describe("compareSemver", () => {
  it("compares core versions numerically (not lexically)", () => {
    expect(compareSemver("0.10.1", "0.9.99")).toBe(1);
    expect(compareSemver("0.9.99", "0.10.1")).toBe(-1);
  });
  it("returns 0 for identical versions", () => {
    expect(compareSemver("1.2.3", "1.2.3")).toBe(0);
  });
  it("treats stable as greater than prerelease of the same core", () => {
    expect(compareSemver("0.10.1", "0.10.1-dev.3")).toBe(1);
    expect(compareSemver("0.10.1-dev.3", "0.10.1")).toBe(-1);
  });
  it("compares numeric prerelease identifiers numerically", () => {
    expect(compareSemver("0.10.1-dev.10", "0.10.1-dev.2")).toBe(1);
  });
});

describe("checkForUpdate — throttle", () => {
  it("skips the HTTP hop when last_check_time is within the window", async () => {
    const store = new UpdateStateStore({ backend: "memory" });
    const now = 1_700_000_000_000;
    await store.write({
      last_check_time: now - 60_000, // 60s ago
      latest_known_version: "0.10.2",
      latest_known_install_url: "https://example.com/leadbay-0.10.2.mcpb",
      latest_known_release_url: "https://example.com/releases/0.10.2",
      suppressed_versions: [],
    });
    const fetchImpl = vi.fn();
    const tel = makeTelemetry();
    const info = await checkForUpdate({
      currentVersion: "0.10.1",
      stateStore: store,
      telemetry: tel,
      now: () => now,
      fetchImpl: fetchImpl as any,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(info?.latest_version).toBe("0.10.2");
    expect(info?.install_url).toBe("https://example.com/leadbay-0.10.2.mcpb");
    expect(getCachedUpdateInfo()?.latest_version).toBe("0.10.2");
  });

  // Regression: a previous process inside the 24h window persisted
  // last_check_time + latest_known_version="0.10.2". A NEW process boots
  // after release 0.10.3 ships. Without force=true at boot, the new
  // session inherits the throttle and never learns 0.10.3 exists.
  it("force=true bypasses the throttle so fresh boots learn about new releases", async () => {
    const store = new UpdateStateStore({ backend: "memory" });
    const now = 1_700_000_000_000;
    await store.write({
      last_check_time: now - 60_000, // 60s ago — well within 24h
      latest_known_version: "0.10.2",
      latest_known_install_url: "https://example.com/leadbay-0.10.2.mcpb",
      latest_known_release_url: "https://example.com/releases/0.10.2",
      suppressed_versions: [],
    });
    const fetchImpl = fakeFetch([
      {
        status: 200,
        etag: 'W/"fresh"',
        body: {
          tag_name: "mcp-v0.10.3",
          html_url: "https://example.com/releases/0.10.3",
          assets: [
            {
              name: "leadbay-0.10.3.mcpb",
              browser_download_url: "https://example.com/0.10.3.mcpb",
            },
          ],
        },
      },
    ]);
    const info = await checkForUpdate({
      currentVersion: "0.10.2",
      stateStore: store,
      telemetry: NOOP_TELEMETRY,
      now: () => now,
      fetchImpl,
      force: true,
    });
    expect(info?.latest_version).toBe("0.10.3");
    expect(info?.install_url).toBe("https://example.com/0.10.3.mcpb");
    const s = await store.read();
    expect(s.latest_known_version).toBe("0.10.3");
    expect(s.last_check_time).toBe(now);
  });
});

describe("checkForUpdate — 200 OK newer release", () => {
  it("parses tag_name, prefers the .dxt asset, persists state, populates cache", async () => {
    const store = new UpdateStateStore({ backend: "memory" });
    const tel = makeTelemetry();
    const fetchImpl = fakeFetch([
      {
        status: 200,
        etag: 'W/"new-etag"',
        body: {
          tag_name: "mcp-v0.10.2",
          html_url: "https://github.com/leadbay/leadclaw/releases/tag/mcp-v0.10.2",
          assets: [
            { name: "leadbay-0.10.2.dxt", browser_download_url: "https://gh.example/0.10.2.dxt" },
            { name: "leadbay-0.10.2.mcpb", browser_download_url: "https://gh.example/0.10.2.mcpb" },
          ],
        },
      },
    ]);
    const now = 1_700_000_000_000;
    const info = await checkForUpdate({
      currentVersion: "0.10.1",
      stateStore: store,
      telemetry: tel,
      now: () => now,
      fetchImpl,
    });
    expect(info).toEqual({
      current_version: "0.10.1",
      latest_version: "0.10.2",
      // .dxt preferred over .mcpb when both assets are published.
      install_url: "https://gh.example/0.10.2.dxt",
      release_url: "https://github.com/leadbay/leadclaw/releases/tag/mcp-v0.10.2",
    });
    const s = await store.read();
    expect(s.latest_known_version).toBe("0.10.2");
    expect(s.latest_known_install_url).toBe("https://gh.example/0.10.2.dxt");
    expect(s.etag).toBe('W/"new-etag"');
    expect(s.last_check_time).toBe(now);
    expect(tel.checks).toEqual([
      { current_version: "0.10.1", latest_version: "0.10.2" },
    ]);
  });

  it("returns null when the upstream is older than us", async () => {
    const store = new UpdateStateStore({ backend: "memory" });
    const tel = makeTelemetry();
    const fetchImpl = fakeFetch([
      {
        status: 200,
        body: {
          tag_name: "mcp-v0.9.0",
          html_url: "https://example.com/releases/0.9.0",
          assets: [{ name: "leadbay-0.9.0.mcpb", browser_download_url: "https://example.com/0.9.0.mcpb" }],
        },
      },
    ]);
    const info = await checkForUpdate({
      currentVersion: "0.10.1",
      stateStore: store,
      telemetry: tel,
      now: () => 1,
      fetchImpl,
    });
    expect(info).toBeNull();
    expect(getCachedUpdateInfo()).toBeNull();
  });

  it("falls back to .mcpb asset when no .dxt is published", async () => {
    const store = new UpdateStateStore({ backend: "memory" });
    const fetchImpl = fakeFetch([
      {
        status: 200,
        body: {
          tag_name: "mcp-v0.10.2",
          html_url: "https://example.com/releases/0.10.2",
          assets: [
            { name: "leadbay-0.10.2.mcpb", browser_download_url: "https://example.com/0.10.2.mcpb" },
          ],
        },
      },
    ]);
    const info = await checkForUpdate({
      currentVersion: "0.10.1",
      stateStore: store,
      telemetry: NOOP_TELEMETRY,
      now: () => 1,
      fetchImpl,
    });
    expect(info?.install_url).toBe("https://example.com/0.10.2.mcpb");
  });
});

describe("checkForUpdate — in-flight guard", () => {
  it("de-dupes onto a single shared promise when a check is already running", async () => {
    const store = new UpdateStateStore({ backend: "memory" });
    const tel = makeTelemetry();
    let resolveFirst!: () => void;
    const firstPending = new Promise<void>((res) => {
      resolveFirst = res;
    });
    let fetchCalls = 0;
    const fetchImpl = (async () => {
      fetchCalls += 1;
      await firstPending;
      const headers = new Headers();
      headers.set("etag", 'W/"x"');
      return {
        status: 200,
        headers,
        json: async () => ({
          tag_name: "mcp-v0.10.2",
          html_url: "https://example.com/0.10.2",
          assets: [
            {
              name: "leadbay-0.10.2.dxt",
              browser_download_url: "https://example.com/0.10.2.dxt",
            },
          ],
        }),
      };
    }) as typeof fetch;

    const first = checkForUpdate({
      currentVersion: "0.10.1",
      stateStore: store,
      telemetry: tel,
      now: () => 1,
      fetchImpl,
    });
    // Second call lands while the first is still awaiting fetch. It must NOT
    // fire a second fetch, AND it must share the SAME in-flight promise (the
    // fix for the boot-race: a concurrent caller can now await the real result
    // instead of getting an instant stale-null). We do NOT await it yet — that
    // would deadlock until resolveFirst() below.
    const second = checkForUpdate({
      currentVersion: "0.10.1",
      stateStore: store,
      telemetry: tel,
      now: () => 1,
      fetchImpl,
    });
    expect(second).toBe(first); // same shared in-flight promise — no 2nd fetch
    // Let the first call's pre-fetch microtasks (stateStore.read) flush so the
    // single fetch has actually been invoked before we assert the count.
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchCalls).toBe(1); // de-duped — exactly one fetch in flight

    resolveFirst();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    // Both resolve to the real upgrade once the single fetch settles.
    expect(firstResult).toMatchObject({
      latest_version: "0.10.2",
      install_url: "https://example.com/0.10.2.dxt",
    });
    expect(secondResult).toEqual(firstResult);
    expect(fetchCalls).toBe(1);
  });
});

describe("checkForUpdate — 304 Not Modified", () => {
  it("refreshes last_check_time, keeps prior latest", async () => {
    const store = new UpdateStateStore({ backend: "memory" });
    await store.write({
      last_check_time: 0,
      latest_known_version: "0.10.2",
      latest_known_install_url: "https://example.com/leadbay-0.10.2.mcpb",
      latest_known_release_url: "https://example.com/releases/0.10.2",
      etag: 'W/"prev"',
      suppressed_versions: [],
    });
    const fetchImpl = fakeFetch([{ status: 304, etag: 'W/"prev"' }]);
    const now = 1_700_000_000_000;
    const info = await checkForUpdate({
      currentVersion: "0.10.1",
      stateStore: store,
      telemetry: NOOP_TELEMETRY,
      now: () => now,
      fetchImpl,
    });
    expect(info?.latest_version).toBe("0.10.2");
    const s = await store.read();
    expect(s.last_check_time).toBe(now);
    expect(s.latest_known_version).toBe("0.10.2");
  });
});

describe("checkForUpdate — failure modes", () => {
  it("swallows network errors, emits check_error, returns null", async () => {
    const store = new UpdateStateStore({ backend: "memory" });
    const tel = makeTelemetry();
    const fetchImpl = (async () => {
      throw new Error("ECONNRESET");
    }) as typeof fetch;
    const info = await checkForUpdate({
      currentVersion: "0.10.1",
      stateStore: store,
      telemetry: tel,
      now: () => 1,
      fetchImpl,
    });
    expect(info).toBeNull();
    expect(tel.checks).toEqual([
      { current_version: "0.10.1", check_error: "ECONNRESET" },
    ]);
    expect(getCachedUpdateInfo()).toBeNull();
  });

  it("emits check_error on non-2xx/304 statuses", async () => {
    const store = new UpdateStateStore({ backend: "memory" });
    const tel = makeTelemetry();
    const fetchImpl = fakeFetch([{ status: 503 }]);
    await checkForUpdate({
      currentVersion: "0.10.1",
      stateStore: store,
      telemetry: tel,
      now: () => 1,
      fetchImpl,
    });
    expect(tel.checks).toEqual([
      { current_version: "0.10.1", check_error: "http_503" },
    ]);
  });
});

describe("checkForUpdate — suppression filters", () => {
  it("returns null when latest_version is in suppressed_versions", async () => {
    const store = new UpdateStateStore({ backend: "memory" });
    await store.write({
      last_check_time: 0,
      suppressed_versions: ["0.10.2"],
    });
    const fetchImpl = fakeFetch([
      {
        status: 200,
        body: {
          tag_name: "mcp-v0.10.2",
          html_url: "https://example.com/0.10.2",
          assets: [{ name: "leadbay-0.10.2.mcpb", browser_download_url: "https://example.com/0.10.2.mcpb" }],
        },
      },
    ]);
    const info = await checkForUpdate({
      currentVersion: "0.10.1",
      stateStore: store,
      telemetry: NOOP_TELEMETRY,
      now: () => 1,
      fetchImpl,
    });
    expect(info).toBeNull();
  });

  it("returns null while remind_until is in the future", async () => {
    const store = new UpdateStateStore({ backend: "memory" });
    const now = 1_700_000_000_000;
    await store.write({
      last_check_time: 0,
      suppressed_versions: [],
      remind_until: now + 60_000,
    });
    const fetchImpl = fakeFetch([
      {
        status: 200,
        body: {
          tag_name: "mcp-v0.10.2",
          html_url: "https://example.com/0.10.2",
          assets: [{ name: "leadbay-0.10.2.mcpb", browser_download_url: "https://example.com/0.10.2.mcpb" }],
        },
      },
    ]);
    const info = await checkForUpdate({
      currentVersion: "0.10.1",
      stateStore: store,
      telemetry: NOOP_TELEMETRY,
      now: () => now,
      fetchImpl,
    });
    expect(info).toBeNull();
  });
});

describe("recordRunningVersion", () => {
  it("emits mcp_version_updated when current > previous", async () => {
    const store = new UpdateStateStore({ backend: "memory" });
    await store.write({
      last_check_time: 0,
      suppressed_versions: ["0.10.1"],
      previous_running_version: "0.10.1",
      remind_until: 999,
    });
    const tel = makeTelemetry();
    await recordRunningVersion("0.10.2", store, tel);
    expect(tel.versionUpdated).toEqual([
      { from_version: "0.10.1", to_version: "0.10.2" },
    ]);
    const s = await store.read();
    expect(s.previous_running_version).toBe("0.10.2");
    // remind_until cleared (user effectively answered the prompt by upgrading).
    expect(s.remind_until).toBeUndefined();
    // 0.10.1 dropped from suppression (we passed it).
    expect(s.suppressed_versions).toEqual([]);
  });

  it("is a noop when previous_running_version matches current", async () => {
    const store = new UpdateStateStore({ backend: "memory" });
    await store.write({
      last_check_time: 0,
      suppressed_versions: [],
      previous_running_version: "0.10.1",
    });
    const tel = makeTelemetry();
    await recordRunningVersion("0.10.1", store, tel);
    expect(tel.versionUpdated).toEqual([]);
  });

  it("writes previous_running_version on first run without emitting", async () => {
    // First-ever boot — previous is undefined; we record it but don't
    // emit version-updated (no prior baseline to upgrade FROM).
    const store = new UpdateStateStore({ backend: "memory" });
    const tel = makeTelemetry();
    await recordRunningVersion("0.10.1", store, tel);
    expect(tel.versionUpdated).toEqual([]);
    const s = await store.read();
    expect(s.previous_running_version).toBe("0.10.1");
  });
});
