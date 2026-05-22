/**
 * checkLoginCollision — guards re-login from clobbering a different account's
 * credentials, without false-firing on legitimate same-account token rotation.
 *
 * The original 0.3.0 implementation compared tokens by equality, which always
 * fired on re-login because loginAt() mints a fresh token on every call. This
 * unit test pins the corrected identity rule (email + region) so the bug
 * cannot regress.
 */
import { describe, it, expect } from "vitest";
import { checkLoginCollision } from "../../src/bin.js";

const CFG = (email: string, region: "us" | "fr", token = "u.tok") => ({
  email,
  mcpServers: {
    leadbay: {
      command: "npx",
      args: ["-y", "@leadbay/mcp@0.13"],
      env: { LEADBAY_TOKEN: token, LEADBAY_REGION: region },
    },
  },
});

describe("checkLoginCollision — same-account re-login is allowed", () => {
  it("same email + same region + DIFFERENT token → no collision", () => {
    // The bug: 0.3.0 originally compared tokens. loginAt() mints a fresh token
    // on every call, so a re-login on the same account would always be rejected
    // unless --force was passed. This test pins the fix.
    const existing = CFG("milstan@leadbay.ai", "us", "u.OLD-TOKEN");
    expect(
      checkLoginCollision(existing, "milstan@leadbay.ai", "us")
    ).toBeNull();
  });

  it("0.2.x config with no email field → no collision (user clearly wants refresh)", () => {
    const legacy = {
      mcpServers: {
        leadbay: { command: "npx", args: [], env: { LEADBAY_TOKEN: "u.x" } },
      },
    };
    expect(checkLoginCollision(legacy, "any@example.com", "us")).toBeNull();
  });

  it("0.2.x config with no email, no region → no collision", () => {
    const minimal = { mcpServers: { leadbay: { command: "npx", env: {} } } };
    expect(checkLoginCollision(minimal, "any@example.com", "us")).toBeNull();
  });
});

describe("checkLoginCollision — different account is refused", () => {
  it("different email → collision message names the existing email", () => {
    const existing = CFG("alice@example.com", "us");
    const reason = checkLoginCollision(existing, "bob@example.com", "us");
    expect(reason).not.toBeNull();
    expect(reason).toMatch(/alice@example\.com/);
    expect(reason).toMatch(/bob@example\.com/);
  });

  it("same email but different region → collision message names the existing region", () => {
    const existing = CFG("milstan@leadbay.ai", "fr");
    const reason = checkLoginCollision(existing, "milstan@leadbay.ai", "us");
    expect(reason).not.toBeNull();
    expect(reason).toMatch(/region=fr/);
    expect(reason).toMatch(/region=us/);
  });

  it("different email AND different region → reports the email mismatch first", () => {
    const existing = CFG("alice@example.com", "fr");
    const reason = checkLoginCollision(existing, "bob@example.com", "us");
    expect(reason).toMatch(/alice@example\.com/);
  });
});

describe("checkLoginCollision — degraded inputs", () => {
  it("null → reports invalid JSON", () => {
    expect(checkLoginCollision(null, "x@y.com", "us")).toMatch(/not valid JSON/);
  });

  it("non-object (string) → reports invalid JSON", () => {
    expect(checkLoginCollision("garbage", "x@y.com", "us")).toMatch(/not valid JSON/);
  });

  it("empty email field on existing → treated as missing (no collision)", () => {
    const existing = { ...CFG("milstan@leadbay.ai", "us"), email: "" };
    expect(checkLoginCollision(existing, "anyone@example.com", "us")).toBeNull();
  });

  it("non-string email field on existing → treated as missing (no collision)", () => {
    const existing = { ...CFG("milstan@leadbay.ai", "us"), email: 42 as any };
    expect(checkLoginCollision(existing, "anyone@example.com", "us")).toBeNull();
  });
});
