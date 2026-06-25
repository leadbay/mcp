/**
 * Regression tests for OAuth-broken-on-Windows (issue #3801).
 *
 * Root cause: the browser auto-open spawned `cmd.exe /c start "" <url>` with the
 * URL UNQUOTED. An OAuth authorize URL is wall-to-wall `&` (query-param
 * separators), and cmd.exe treats a bare `&` as a COMMAND separator — so
 * `start` opened only the fragment before the first `&` (e.g. `…?client_id=99`),
 * the browser landed on a malformed authorize request, and OAuth failed on
 * Windows only (mac/Linux pass the URL as a single argv entry to open/xdg-open,
 * where `&` is inert). cmd.exe itself launched fine, so spawn reported success
 * and the fail-fast clickable-link fallback never fired.
 *
 * Fix pinned here:
 *   1. browserOpenCandidates() double-quotes the URL on win32 only, so cmd
 *      passes the whole URL (every `&` included) through as one token.
 *   2. The mac/Linux candidates keep the URL UNQUOTED (the quoting is win32-only).
 *
 * New file — the existing oauth-browser-open.test.ts is left in place; this adds
 * the multi-`&` URL coverage that proves no truncation.
 */
import { describe, it, expect, afterEach } from "vitest";
import { browserOpenCandidates } from "../../src/oauth.js";

// A realistic authorize URL: many `&`-separated query params. The substring
// after the LAST `&` is the canary — if cmd truncated at `&`, it'd be lost.
const AUTH_URL =
  "https://leadbay.app/oauth/authorize?client_id=99" +
  "&code_challenge=abc123" +
  "&code_challenge_method=S256" +
  "&state=xyz789" +
  "&redirect_uri=http%3A%2F%2F127.0.0.1%3A51789%2Fcallback";

const realPlatform = process.platform;
function setPlatform(p: NodeJS.Platform) {
  Object.defineProperty(process, "platform", { value: p, configurable: true });
}

afterEach(() => setPlatform(realPlatform));

describe("browserOpenCandidates — win32 URL is quoted so cmd doesn't truncate at `&`", () => {
  it("wraps the full multi-`&` URL in double quotes on every win32 candidate", () => {
    setPlatform("win32");
    const savedRoot = process.env.SystemRoot;
    process.env.SystemRoot = "C:\\Windows";
    try {
      const cands = browserOpenCandidates(AUTH_URL);
      for (const c of cands) {
        const last = c.args[c.args.length - 1];
        // The URL token is the exact URL wrapped in double quotes…
        expect(last).toBe(`"${AUTH_URL}"`);
        // …which means the WHOLE URL survives — including the tail after the
        // last `&` (the part cmd would have dropped without quoting).
        expect(last).toContain("redirect_uri=http%3A%2F%2F127.0.0.1%3A51789%2Fcallback");
        // start's empty-title token is still present and precedes the URL.
        expect(c.args).toContain('""');
        expect(c.args.indexOf('""')).toBeLessThan(c.args.length - 1);
      }
    } finally {
      if (savedRoot === undefined) delete process.env.SystemRoot;
      else process.env.SystemRoot = savedRoot;
    }
  });
});

describe("browserOpenCandidates — mac/Linux pass the URL UNQUOTED (quoting is win32-only)", () => {
  it("macOS open receives the raw URL with no surrounding quotes", () => {
    setPlatform("darwin");
    const cands = browserOpenCandidates(AUTH_URL);
    for (const c of cands) {
      expect(c.args).toEqual([AUTH_URL]);
      expect(c.args[0]).not.toMatch(/^".*"$/);
    }
  });

  it("Linux xdg-open receives the raw URL with no surrounding quotes", () => {
    setPlatform("linux");
    const cands = browserOpenCandidates(AUTH_URL);
    for (const c of cands) {
      expect(c.args).toEqual([AUTH_URL]);
      expect(c.args[0]).not.toMatch(/^".*"$/);
    }
  });
});
