/**
 * The one-time intro routing paragraph in the server instructions
 * (leadbay/product#3829). Present only when hasIntro is set; documents the
 * `_meta.intro` field and steers the agent to a markdown card (not a widget).
 *
 * New file (never modify existing test files — repo invariant).
 */

import { describe, it, expect } from "vitest";
import { buildServerInstructions } from "../../src/server.js";

const EXPOSED = new Set<string>(["leadbay_account_status", "leadbay_pull_leads"]);

describe("intro routing paragraph", () => {
  it("documents _meta.intro and the three contact links when hasIntro is true", () => {
    const text = buildServerInstructions(EXPOSED, { hasIntro: true });
    expect(text).toContain("_meta.intro");
    expect(text).toContain("WhatsApp");
    expect(text).toContain("mailto:");
    expect(text).toContain("Book a call");
    // Explicitly informational, not a question widget.
    expect(text).toContain("ask_user_input_v0");
  });

  it("omits the intro paragraph when hasIntro is false / absent", () => {
    expect(buildServerInstructions(EXPOSED, { hasIntro: false })).not.toContain("_meta.intro");
    expect(buildServerInstructions(EXPOSED)).not.toContain("_meta.intro");
  });
});
