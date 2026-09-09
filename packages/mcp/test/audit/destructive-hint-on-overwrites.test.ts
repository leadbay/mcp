// Anthropic's Connectors-Directory review criteria: "destructiveHint: true for
// tools that modify or delete data. These determine auto-permissions in Claude:
// read-only tools can run without per-call confirmation; destructive tools
// always prompt."
//
// The hosted surface had drifted: leadbay_add_note (strictly additive) prompted,
// while leadbay_update_contact and leadbay_update_custom_field overwrote a
// user's existing record with no prompt at all. This audit fixes the line at
// "overwrites an existing record" and keeps it there.
import { describe, expect, it } from "vitest";
import { compositeReadTools, compositeWriteTools } from "@leadbay/core";

const hosted = new Map(
  [...compositeReadTools, ...compositeWriteTools].map((t) => [t.name, t])
);

// Tools that replace a value on a record the user already has.
const OVERWRITES = ["leadbay_update_contact", "leadbay_update_custom_field"];

// Tools that only add or toggle. Kept non-destructive on purpose: prompting on
// every one of these would make ordinary curation unusable.
const ADDITIVE = [
  "leadbay_add_contact",
  "leadbay_create_custom_field",
  "leadbay_pin_contact",
  "leadbay_unpin_contact",
];

describe("audit: destructiveHint marks the tools that overwrite user data", () => {
  it.each(OVERWRITES)("%s prompts before it overwrites", (name) => {
    const tool = hosted.get(name);
    expect(tool, `${name} is not on the hosted surface`).toBeDefined();
    expect(tool!.annotations?.destructiveHint).toBe(true);
    expect(tool!.annotations?.readOnlyHint).toBe(false);
  });

  it.each(ADDITIVE)("%s stays non-destructive", (name) => {
    const tool = hosted.get(name);
    expect(tool, `${name} is not on the hosted surface`).toBeDefined();
    expect(tool!.annotations?.destructiveHint).toBe(false);
  });

  it("every hosted tool declares one of the two hints the directory reads", () => {
    const undeclared = [...hosted.values()].filter(
      (t) =>
        t.annotations?.readOnlyHint === undefined &&
        t.annotations?.destructiveHint === undefined
    );
    expect(undeclared.map((t) => t.name)).toEqual([]);
  });

  it("every hosted tool has a title and a name within the 64-char limit", () => {
    for (const t of hosted.values()) {
      expect(t.annotations?.title, t.name).toBeTruthy();
      expect(t.name.length, t.name).toBeLessThanOrEqual(64);
    }
  });
});
