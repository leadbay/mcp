/**
 * clearOAuthClientId (~/.leadbay/oauth-client.json) — product#3838.
 *
 * The self-heal path evicts a rejected cached client_id so the next launch
 * registers fresh, and `login --oauth --reset-client` drops the whole auth
 * server's cache. This pins both: per-port eviction and whole-server clear,
 * and that the file stays 0600.
 *
 * New file — models the tmp-HOME pattern in ./oauth-client-cache.test.ts
 * (which is left untouched). HOME is redirected so the real cache is safe.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cacheOAuthClientId, getCachedOAuthClientId, clearOAuthClientId } from "../../src/bin.js";

const SERVER = "https://api-us.leadbay.app";
const OTHER = "https://api-fr.leadbay.app";
const SAVED: Record<string, string | undefined> = {};
const KEYS = ["HOME", "XDG_CONFIG_HOME", "APPDATA", "USERPROFILE"];
let tmpHome: string;

beforeEach(() => {
  for (const k of KEYS) SAVED[k] = process.env[k];
  for (const k of KEYS) delete process.env[k];
  tmpHome = mkdtempSync(join(tmpdir(), "lb-clientclear-"));
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
});
afterEach(() => {
  for (const k of KEYS) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  }
  rmSync(tmpHome, { recursive: true, force: true });
});

const cachePath = () => join(tmpHome, ".leadbay", "oauth-client.json");

describe("clearOAuthClientId — per-port eviction", () => {
  it("drops only the named port, retaining others", () => {
    cacheOAuthClientId(SERVER, "id-89", 51789);
    cacheOAuthClientId(SERVER, "id-90", 51790);

    clearOAuthClientId(SERVER, 51789);

    expect(getCachedOAuthClientId(SERVER, 51789)).toBeUndefined();
    expect(getCachedOAuthClientId(SERVER, 51790)).toBe("id-90");
  });

  it("keeps the file 0600 after a clear", () => {
    cacheOAuthClientId(SERVER, "id-89", 51789);
    clearOAuthClientId(SERVER, 51789);
    const mode = statSync(cachePath()).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});

describe("clearOAuthClientId — whole-server clear (--reset-client)", () => {
  it("drops every port for the server but leaves other servers intact", () => {
    cacheOAuthClientId(SERVER, "id-89", 51789);
    cacheOAuthClientId(SERVER, "id-90", 51790);
    cacheOAuthClientId(OTHER, "fr-89", 51789);

    clearOAuthClientId(SERVER); // no port → whole server

    expect(getCachedOAuthClientId(SERVER, 51789)).toBeUndefined();
    expect(getCachedOAuthClientId(SERVER, 51790)).toBeUndefined();
    expect(getCachedOAuthClientId(OTHER, 51789)).toBe("fr-89");
    // The other server's entry is preserved in the file.
    const parsed = JSON.parse(readFileSync(cachePath(), "utf8"));
    expect(parsed.clients[SERVER]).toBeUndefined();
    expect(parsed.clients[OTHER].byPort["51789"]).toBe("fr-89");
  });
});

describe("clearOAuthClientId — safe no-ops", () => {
  it("does nothing when there is no cache file", () => {
    expect(() => clearOAuthClientId(SERVER, 51789)).not.toThrow();
    expect(() => clearOAuthClientId(SERVER)).not.toThrow();
  });

  it("does nothing when the server isn't cached", () => {
    cacheOAuthClientId(OTHER, "fr-89", 51789);
    clearOAuthClientId(SERVER, 51789);
    expect(getCachedOAuthClientId(OTHER, 51789)).toBe("fr-89");
  });
});
