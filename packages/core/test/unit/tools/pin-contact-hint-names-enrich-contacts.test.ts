/**
 * product#4050 — the pin 404 is where an agent that wants to enrich one
 * named person lands (0.33.3). Now that leadbay_enrich_contacts is on the
 * default surface, the hint must name it as the direct route, next to the
 * by-title and add-contact routes it already named.
 */

import { describe, it, expect } from "vitest";
import { NOT_PINNABLE_HINT } from "../../../src/tools/pin-contact.js";
import { leadbay_pin_contact, leadbay_unpin_contact } from "../../../src/tool-descriptions.generated.js";

describe("pin NOT_FOUND hint names the direct enrichment route", () => {
  it("the runtime hint names leadbay_enrich_contacts alongside the existing routes", () => {
    expect(NOT_PINNABLE_HINT).toContain("leadbay_enrich_contacts");
    expect(NOT_PINNABLE_HINT).toContain("leadbay_enrich_titles");
    expect(NOT_PINNABLE_HINT).toContain("leadbay_add_contact");
    expect(NOT_PINNABLE_HINT).toContain("do NOT retry");
  });

  it("both pin and unpin descriptions (shared snippet) name it too", () => {
    for (const desc of [leadbay_pin_contact, leadbay_unpin_contact]) {
      expect(desc).toContain("leadbay_enrich_contacts");
      expect(desc).toContain("Pinning does not steer enrichment");
    }
  });
});
