import { describe, it, expect } from "vitest";
import { LeadbayClient } from "@leadbay/core";

describe("the derivation the harness now relies on", () => {
  // Pinning the client behaviour too: the audit above is a source grep, and a
  // grep cannot tell a correct derivation from a broken one.
  it("derives us/fr from the known regional URLs", () => {
    expect(new LeadbayClient("https://api-us.leadbay.app", "t").region).toBe("us");
    expect(new LeadbayClient("https://api-fr.leadbay.app", "t").region).toBe("fr");
  });

  it("derives custom from an unrecognised staging host", () => {
    expect(new LeadbayClient("https://api-staging.leadbay.app", "t").region).toBe("custom");
  });

  it("an explicit pin still wins over the URL", () => {
    expect(new LeadbayClient("https://api-staging.leadbay.app", "t", "fr").region).toBe("fr");
  });
});
