/**
 * Audit: the delivery jobs are advertised as progress-capable long runners.
 *
 * `ctx.progress` only exists when the MCP request carried a progressToken, and
 * the only thing that tells a client to send one is the "Protocol primitives"
 * paragraph in the server instructions. The delivery tools block-poll for 45s
 * by default and up to 180s, so if they are missing from that list the call
 * looks frozen for minutes and the per-poll progress callback is simply never
 * invoked.
 *
 * Also pinned: the iter-12 invariant that buildServerInstructions never names
 * a tool the deployment does not expose. These three are release-gated, so a
 * default deployment must not see them advertised.
 */

import { describe, it, expect } from "vitest";
import { buildServerInstructions } from "../../src/server.js";

const DELIVERY = [
  "leadbay_find_new_leads",
  "leadbay_qualify_leads",
  "leadbay_lead_job_status",
];

/** The paragraph names tools only in the progressToken sentence. */
function instructionsFor(exposed: string[]): string {
  return buildServerInstructions(new Set(exposed));
}

describe("audit: delivery tools advertised as long runners", () => {
  it("names all three when they are exposed", () => {
    const text = instructionsFor([...DELIVERY, "leadbay_pull_leads"]);
    const progressLine = text
      .split("\n")
      .find((l) => l.includes("Pass a progressToken on"));
    expect(progressLine, "no progressToken sentence in instructions").toBeTruthy();
    for (const name of DELIVERY) {
      expect(progressLine, `${name} missing from the long-runner list`).toContain(
        name
      );
    }
  });

  it("names none of them on a deployment without the delivery tools", () => {
    // iter-12 invariant: never advertise a tool the agent cannot call.
    const text = instructionsFor([
      "leadbay_pull_leads",
      "leadbay_bulk_qualify_leads",
    ]);
    for (const name of DELIVERY) {
      expect(text, `${name} advertised while not exposed`).not.toContain(name);
    }
  });

  it("keeps the legacy long runners listed", () => {
    // The delivery tools are an addition, not a replacement.
    const text = instructionsFor([
      ...DELIVERY,
      "leadbay_bulk_qualify_leads",
      "leadbay_enrich_titles",
    ]);
    expect(text).toContain("leadbay_bulk_qualify_leads");
    expect(text).toContain("leadbay_enrich_titles");
  });
});
