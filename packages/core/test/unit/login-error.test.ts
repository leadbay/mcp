/**
 * Unit tests for formatLoginError.
 *
 * Regression guard for #3504: when the backend returns 401 with an empty body,
 * the previous message ended with a dangling colon ("login failed (401) at
 * https://api-fr.leadbay.app:"). This formatter has to stay user-legible for
 * the main failure modes: bad credentials, rate-limiting, server error.
 */
import { describe, it, expect } from "vitest";
import { formatLoginError } from "../../src/client.js";

const URL_US = "https://api-us.leadbay.app";
const URL_FR = "https://api-fr.leadbay.app";

describe("formatLoginError", () => {
  it("401 with empty body → suggests wrong credentials, no dangling colon", () => {
    const msg = formatLoginError(401, "", URL_FR);
    expect(msg).toBe(
      "login failed (401) at https://api-fr.leadbay.app (wrong email or password?)"
    );
    expect(msg).not.toMatch(/:\s*$/);
    expect(msg).not.toMatch(/:\s*\(/); // no " : (" sequence
  });

  it("401 with body → includes body AND the credentials hint", () => {
    const msg = formatLoginError(401, '{"error":"invalid_credentials"}', URL_FR);
    expect(msg).toContain("login failed (401) at https://api-fr.leadbay.app");
    expect(msg).toContain('{"error":"invalid_credentials"}');
    expect(msg).toContain("(wrong email or password?)");
  });

  it("429 with empty body → rate-limit hint", () => {
    const msg = formatLoginError(429, "", URL_US);
    expect(msg).toBe(
      "login failed (429) at https://api-us.leadbay.app (rate-limited; wait and retry)"
    );
  });

  it("500 with body → server error hint", () => {
    const msg = formatLoginError(500, "internal server error", URL_US);
    expect(msg).toContain("login failed (500)");
    expect(msg).toContain("internal server error");
    expect(msg).toContain("(server error; try again shortly)");
  });

  it("502 with empty body → server error hint, no dangling colon", () => {
    const msg = formatLoginError(502, "", URL_FR);
    expect(msg).toBe(
      "login failed (502) at https://api-fr.leadbay.app (server error; try again shortly)"
    );
  });

  it("403 (uncommon) with empty body → no hint, but also no dangling colon", () => {
    const msg = formatLoginError(403, "", URL_US);
    expect(msg).toBe("login failed (403) at https://api-us.leadbay.app");
  });

  it("very long body is truncated at 200 chars", () => {
    const long = "x".repeat(500);
    const msg = formatLoginError(401, long, URL_US);
    // 200 chars of body + separator/hint framing.
    expect(msg).toContain("x".repeat(200));
    expect(msg).not.toContain("x".repeat(201));
    expect(msg).toContain("(wrong email or password?)");
  });

  it("body with surrounding whitespace is treated as empty", () => {
    const msg = formatLoginError(401, "   \n\t  ", URL_FR);
    expect(msg).toBe(
      "login failed (401) at https://api-fr.leadbay.app (wrong email or password?)"
    );
  });
});
