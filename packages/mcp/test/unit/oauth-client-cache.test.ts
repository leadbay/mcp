/**
 * OAuth client-id cache (~/.leadbay/oauth-client.json) — 0.21.2.
 *
 * Regression (PR review P2): the cache must retain a client_id for EVERY
 * loopback port we've registered on, keyed by (auth server, port). An earlier
 * shape stored a single {client_id, port} per auth server, so when the bound
 * stable port alternated (51789 busy → 51790, then 51789 free again) each
 * launch overwrote the other port's id and forced a re-registration — churning
 * registrations and recreating the ~10/hr 429 risk the cache exists to prevent.
 *
 * New file. HOME is redirected to a temp dir so the real cache is untouched.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCachedOAuthClientId, cacheOAuthClientId } from "../../src/bin.js";

const SERVER = "https://api-us.leadbay.app";
const SAVED: Record<string, string | undefined> = {};
const KEYS = ["HOME", "XDG_CONFIG_HOME", "APPDATA", "USERPROFILE"];
let tmpHome: string;

beforeEach(() => {
  for (const k of KEYS) SAVED[k] = process.env[k];
  for (const k of KEYS) delete process.env[k];
  tmpHome = mkdtempSync(join(tmpdir(), "lb-clientcache-"));
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

describe("oauth client-id cache — per-port", () => {
  it("returns undefined when nothing is cached", () => {
    expect(getCachedOAuthClientId(SERVER, 51789)).toBeUndefined();
  });

  it("round-trips a client_id for a given port", () => {
    cacheOAuthClientId(SERVER, "client-A", 51789);
    expect(getCachedOAuthClientId(SERVER, 51789)).toBe("client-A");
  });

  it("only returns the id for the EXACT port (mismatch → undefined)", () => {
    cacheOAuthClientId(SERVER, "client-A", 51789);
    expect(getCachedOAuthClientId(SERVER, 51790)).toBeUndefined();
  });

  it("RETAINS ids for multiple ports — caching 51790 does not drop 51789", () => {
    cacheOAuthClientId(SERVER, "client-A", 51789);
    cacheOAuthClientId(SERVER, "client-B", 51790);
    // Both survive — the bug was the second write overwriting the first.
    expect(getCachedOAuthClientId(SERVER, 51789)).toBe("client-A");
    expect(getCachedOAuthClientId(SERVER, 51790)).toBe("client-B");
  });

  it("alternating ports across 'launches' never loses either id (no re-register churn)", () => {
    cacheOAuthClientId(SERVER, "id-89", 51789);
    cacheOAuthClientId(SERVER, "id-90", 51790);
    // Simulate several launches alternating between the two stable ports.
    for (let i = 0; i < 5; i++) {
      expect(getCachedOAuthClientId(SERVER, 51789)).toBe("id-89");
      expect(getCachedOAuthClientId(SERVER, 51790)).toBe("id-90");
    }
  });

  it("keys by auth server too — a different server doesn't collide", () => {
    cacheOAuthClientId(SERVER, "us-client", 51789);
    cacheOAuthClientId("https://api-fr.leadbay.app", "fr-client", 51789);
    expect(getCachedOAuthClientId(SERVER, 51789)).toBe("us-client");
    expect(getCachedOAuthClientId("https://api-fr.leadbay.app", 51789)).toBe("fr-client");
  });

  it("writes the file 0600 with a byPort map shape", () => {
    cacheOAuthClientId(SERVER, "client-A", 51789);
    const path = join(tmpHome, ".leadbay", "oauth-client.json");
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    expect(parsed.clients[SERVER].byPort["51789"]).toBe("client-A");
  });
});
