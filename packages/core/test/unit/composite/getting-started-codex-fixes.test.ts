/**
 * Regression cover for the Codex review on PR #175 (merged before the review
 * landed, fixed forward). New file rather than edits to
 * getting-started.test.ts — that file is reviewed as a unit.
 *
 * The two findings here are the ones that cost money or corrupt state, so each
 * is pinned by the property that was actually wrong, not by nearby prose.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockHttp, resetHttpMock, httpsMockFactory } from "../../harness.js";
vi.mock("node:https", () => httpsMockFactory());

import { LeadbayClient } from "../../../src/client.js";
import {
  gettingStarted,
  GETTING_STARTED_MANIFEST,
} from "../../../src/composite/getting-started.js";

const BASE = "https://api-us.leadbay.app";
const newClient = () => new LeadbayClient(BASE, "u.test-token", "us");

beforeEach(() => resetHttpMock());

describe("leadbay_getting_started — Codex #175 fixes", () => {
  it("returns a fresh manifest per call, so per-call _meta cannot stick", async () => {
    // The server attaches _meta.update_available / _meta.notifications to
    // successful results IN PLACE. Returning the module singleton by reference
    // let one call's notifications survive into the next — including ones the
    // user had already acknowledged.
    mockHttp([]);
    const a = (await gettingStarted.execute(newClient(), {})) as Record<string, unknown>;
    mockHttp([]);
    const b = (await gettingStarted.execute(newClient(), {})) as Record<string, unknown>;

    expect(a).not.toBe(GETTING_STARTED_MANIFEST);
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
    // Nested structures must be copies too — a shallow clone would still share
    // `steps`, which is where the agent-facing content lives.
    expect((a.steps as unknown[])[0]).not.toBe((b.steps as unknown[])[0]);

    // Simulate the server's in-place annotation on one response.
    (a as { _meta?: unknown })._meta = { notifications: ["stale"] };
    mockHttp([]);
    const c = (await gettingStarted.execute(newClient(), {})) as Record<string, unknown>;
    expect(c._meta, "a later call inherited the previous call's _meta").toBeUndefined();
    expect(
      (GETTING_STARTED_MANIFEST as unknown as Record<string, unknown>)._meta,
      "the static manifest was contaminated",
    ).toBeUndefined();
  });

  it("the paid reveal passes leadIds as an ARRAY, never a singular leadId", () => {
    // leadbay_enrich_titles only reads `leadIds?: string[]`. A singular
    // `leadId` is not a parameter — it is dropped, and the confirmed call then
    // falls back to the account's DEFAULT WISHLIST SELECTION while confirm and
    // email are set. That charges for the whole batch instead of the one lead
    // the user agreed to, which is the worst outcome this tour can produce.
    const gate4 = GETTING_STARTED_MANIFEST.steps[3];
    expect(gate4.calls).toBe("leadbay_enrich_titles");
    expect(gate4.spend).toMatch(/leadIds:\s*\[/);
    expect(gate4.spend).toMatch(/ALWAYS the array/i);
    // The reason has to travel with the rule, or a later trim restores the
    // shorter-looking singular form.
    expect(gate4.spend).toMatch(/default wishlist selection/i);
    // And the scoping arg is plural AND carries its array shape. `args` values
    // are placeholder descriptions, so the brackets are how the shape travels:
    // a bare scalar placeholder invited the agent to send a string and take a
    // BAD_INPUT at the reveal.
    expect(Object.keys(gate4.args ?? {})).toContain("leadIds");
    expect(Object.keys(gate4.args ?? {})).not.toContain("leadId");
    expect(gate4.args?.leadIds).toMatch(/^\[/);
    expect(gate4.args?.leadIds).toMatch(/an ARRAY, always/);
  });

  it("the exit offer's own example obeys its one-sentence rule", () => {
    // A live judge scored IA 3 on this: the prompt demanded "one sentence and
    // the link", then supplied a two-sentence sample listing three things Zoe
    // covers. The agent copied the sample, correctly. A rule whose own example
    // breaks it is not a rule.
    const offer = GETTING_STARTED_MANIFEST.exit_offer;
    expect(offer).toMatch(/ONE SENTENCE/);
    expect(offer).toMatch(/promotional copy/i);
    // The example itself must be a single sentence — one terminal period
    // inside the quoted sample.
    const sample = offer.match(/e\.g\. '([^']+)'/)?.[1] ?? "";
    expect(sample.length, "the offer example is missing").toBeGreaterThan(20);
    expect(
      (sample.match(/\.\s/g) ?? []).length,
      `the example runs more than one sentence: ${sample}`,
    ).toBeLessThanOrEqual(1);
  });

  it("gate 4 ends the tour instead of dead-ending on a read-only deployment", () => {
    // leadbay_enrich_titles is in compositeWriteTools, so under
    // LEADBAY_MCP_WRITE=0 it is never registered — while the tour itself stays
    // exposed via compositeReadTools. Offering a button whose tool cannot run
    // is worse than finishing one step early.
    const gate4 = GETTING_STARTED_MANIFEST.steps[3];
    const branch = (gate4.branches ?? []).find((b) => /NOT in your tool set/i.test(b.when));
    expect(branch, "gate 4 needs a read-only branch").toBeDefined();
    expect(branch!.then).toMatch(/do NOT fire this gate's widget/i);
    expect(branch!.then).toMatch(/close the tour after gate 3/i);
    // It must not go looking for another route to contact details.
    expect(branch!.then).toMatch(/do not hunt for another way/i);
  });
});
