import { describe, it, expect } from "vitest";
import { stripShellExportBlock, mergeShellExportBlock, buildShellExportBlock } from "../../src/bin.js";

// Verify both functions handle CRLF line endings (Windows shell RC files).
// The managed block regex previously used literal \n which silently failed to
// match CRLF content, causing install to report "already present" without
// rotating the token, and uninstall to silently do nothing.

const CRLF = "\r\n";

function crlfBlock(token = "tok", region = "us"): string {
  return [
    "",
    "# Added by leadbay-mcp install",
    `export LEADBAY_TOKEN="${token}"`,
    `export LEADBAY_REGION="${region}"`,
    `export LEADBAY_TELEMETRY_ENABLED="true"`,
    "",
  ].join(CRLF);
}

describe("stripShellExportBlock — CRLF", () => {
  it("removes a CRLF-terminated block", () => {
    const existing = `alias ll="ls -la"${CRLF}${crlfBlock()}`;
    const { content, changed } = stripShellExportBlock(existing);
    expect(changed).toBe(true);
    expect(content).toContain("alias ll");
    expect(content).not.toContain("LEADBAY_TOKEN");
  });

  it("removes CRLF block that includes LEADBAY_MCP_WRITE line", () => {
    const block = [
      "",
      "# Added by leadbay-mcp install",
      `export LEADBAY_TOKEN="tok"`,
      `export LEADBAY_REGION="us"`,
      `export LEADBAY_TELEMETRY_ENABLED="true"`,
      `export LEADBAY_MCP_WRITE="0"`,
      "",
    ].join(CRLF);
    const { content, changed } = stripShellExportBlock(`other${CRLF}${block}`);
    expect(changed).toBe(true);
    expect(content).not.toContain("LEADBAY");
  });

  it("returns changed=false for content with no managed block", () => {
    const { changed } = stripShellExportBlock(`alias ll="ls -la"${CRLF}`);
    expect(changed).toBe(false);
  });
});

describe("mergeShellExportBlock — CRLF", () => {
  it("replaces an existing CRLF block with new token", () => {
    const existing = `alias ll="ls -la"${CRLF}${crlfBlock("old-token")}`;
    const newBlock = buildShellExportBlock("new-token", "fr", true, true);
    const { content, changed } = mergeShellExportBlock(existing, newBlock);
    expect(changed).toBe(true);
    expect(content).toContain("new-token");
    expect(content).not.toContain("old-token");
  });

  it("does not duplicate the block in the output", () => {
    const block = buildShellExportBlock("tok", "us", true, true);
    const { content } = mergeShellExportBlock("existing content\n", block);
    // The output should contain LEADBAY_TOKEN exactly once, not duplicated
    const tokenCount = (content.match(/LEADBAY_TOKEN=/g) ?? []).length;
    expect(tokenCount).toBe(1);
  });
});
