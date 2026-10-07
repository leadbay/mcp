import { describe, it, expect } from "vitest";
import { renderApps, validateAppsMarkers, hasAppsMarkers } from "../src/apps.js";
import { renderCommerce } from "../src/commerce.js";

// `{{apps}}` — prose for the surfaces that serve the MCP Apps boards. The
// REVERSE of `{{commerce}}`: Claude's default rendering DELETES the block, so
// a Claude description must read exactly as if the marker had never existed.

const BLOCK = [
  "---",
  "",
  "{{apps}}",
  "**When the board shows, it is the rendering.** Do not redraw the table.",
  "",
  "{{/apps}}",
  "Leadbay works like an inbox.",
].join("\n");

const WITHOUT_MARKER = ["---", "", "Leadbay works like an inbox."].join("\n");

describe("{{apps}} markers", () => {
  it("the Claude rendering is byte-for-byte the template without the block", () => {
    expect(renderApps(BLOCK, "without")).toBe(WITHOUT_MARKER);
  });

  it("the apps rendering keeps the block and drops only the marker lines", () => {
    expect(renderApps(BLOCK, "with")).toBe(
      [
        "---",
        "",
        "**When the board shows, it is the rendering.** Do not redraw the table.",
        "",
        "Leadbay works like an inbox.",
      ].join("\n"),
    );
  });

  it("works the same on a CRLF template", () => {
    const crlf = BLOCK.replace(/\n/g, "\r\n");
    expect(renderApps(crlf, "without").replace(/\r\n/g, "\n")).toBe(WITHOUT_MARKER);
  });

  it("inline spans delete cleanly", () => {
    const line = "Render the table{{apps}} unless the board shows{{/apps}}.";
    expect(renderApps(line, "without")).toBe("Render the table.");
    expect(renderApps(line, "with")).toBe("Render the table unless the board shows.");
  });

  it("rejects unbalanced markers", () => {
    expect(validateAppsMarkers("{{apps}}\nx\n")).toMatch(/unbalanced/);
    expect(validateAppsMarkers(BLOCK)).toBeNull();
  });

  it("is independent of {{commerce}}: each tag only touches its own blocks", () => {
    const both = "A{{commerce}} buy{{/commerce}}{{apps}} board{{/apps}}.";
    expect(renderApps(renderCommerce(both, "with"), "without")).toBe("A buy.");
    expect(renderApps(renderCommerce(both, "without"), "with")).toBe("A board.");
    expect(hasAppsMarkers("A{{commerce}} buy{{/commerce}}.")).toBe(false);
  });
});
