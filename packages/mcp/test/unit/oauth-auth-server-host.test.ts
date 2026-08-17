// The advertised authorization server must be the host Stargate is actually
// deployed on.
//
// Every other test in the suite asserts against the STARGATE_AUTH_SERVER
// constant, so all of them stayed green while the constant itself pointed at
// `auth.leadbay.app` — a hostname that was planned but never deployed and does
// not resolve. Discovery advertising it means the client fetches
// `/.well-known/oauth-authorization-server` from a dead host and the sign-in
// prompt never appears; nothing in CI notices, because the value is
// self-consistent everywhere.
//
// So this file pins the literal. Stargate lives at `stargate.leadbay.app`
// (staging: `staging.stargate.leadbay.app`) and its metadata declares
// `issuer: "https://stargate.leadbay.app"` — a spec-compliant client rejects
// metadata whose issuer doesn't match the URL it discovered, so the advertised
// origin has to be exactly that one.

import { describe, it, expect } from "vitest";

import { STARGATE_AUTH_SERVER, protectedResourceMetadata } from "../../src/auth-http.js";

// The constant reads the env override at import time; these assertions are about
// the built-in default, so they only apply when nothing overrode it.
const usingDefault = process.env.LEADBAY_AUTH_SERVER === undefined;

describe("STARGATE_AUTH_SERVER default", () => {
  it.runIf(usingDefault)("is the deployed Stargate origin", () => {
    expect(STARGATE_AUTH_SERVER).toBe("https://stargate.leadbay.app");
  });

  it.runIf(usingDefault)("is not the undeployed auth.leadbay.app alias", () => {
    expect(STARGATE_AUTH_SERVER).not.toContain("auth.leadbay.app");
  });

  it("is an https origin with no path — clients append the well-known path", () => {
    const url = new URL(STARGATE_AUTH_SERVER);
    expect(url.protocol).toBe("https:");
    expect(url.pathname).toBe("/");
    expect(STARGATE_AUTH_SERVER.endsWith("/")).toBe(false);
  });

  it("is what protected-resource metadata advertises", () => {
    const doc = protectedResourceMetadata({ resourceUrl: "https://mcp.leadbay.app/mcp" });
    expect(doc.authorization_servers).toEqual([STARGATE_AUTH_SERVER]);
  });
});
