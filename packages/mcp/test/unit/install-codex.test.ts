import { describe, it, expect } from "vitest";
import { buildCodexConfigBlock, buildShellExportBlock, mergeCodexConfig, mergeShellExportBlock } from "../../src/bin.js";

describe("buildCodexConfigBlock", () => {
  it("emits the Codex MCP server table", () => {
    const block = buildCodexConfigBlock(true, true, "0.13");
    expect(block).toContain("[mcp_servers.leadbay]");
  });

  it("uses npx with the requested version pin", () => {
    const block = buildCodexConfigBlock(true, true, "0.13");
    expect(block).toContain("command = \"npx\"");
    expect(block).toContain("args = [\"-y\", \"@leadbay/mcp@0.13\"]");
  });

  it("forwards the required shell env vars", () => {
    const block = buildCodexConfigBlock(true, false, "0.13");
    expect(block).toContain("\"LEADBAY_TOKEN\"");
    expect(block).toContain("\"LEADBAY_REGION\"");
    expect(block).toContain("\"LEADBAY_TELEMETRY_ENABLED\"");
  });

  it("omits LEADBAY_MCP_WRITE when writes are enabled by default", () => {
    const block = buildCodexConfigBlock(true, true, "0.13");
    expect(block).not.toContain("LEADBAY_MCP_WRITE");
  });

  it("includes LEADBAY_MCP_WRITE when installing read-only", () => {
    const block = buildCodexConfigBlock(false, true, "0.13");
    expect(block).toContain("\"LEADBAY_MCP_WRITE\"");
  });
});

describe("buildShellExportBlock", () => {
  it("exports token, region, and telemetry for Codex to forward", () => {
    const block = buildShellExportBlock("my-token", "fr", true, false);
    expect(block).toContain("export LEADBAY_TOKEN=\"my-token\"");
    expect(block).toContain("export LEADBAY_REGION=\"fr\"");
    expect(block).toContain("export LEADBAY_TELEMETRY_ENABLED=\"false\"");
  });

  it("exports LEADBAY_MCP_WRITE only for read-only installs", () => {
    expect(buildShellExportBlock("tok", "us", true, true)).not.toContain("LEADBAY_MCP_WRITE");
    expect(buildShellExportBlock("tok", "us", false, true)).toContain("export LEADBAY_MCP_WRITE=\"0\"");
  });

  it("shell-quotes token values", () => {
    const block = buildShellExportBlock("tok$\\\"x", "us", true, true);
    expect(block).toContain("export LEADBAY_TOKEN=\"tok\\$\\\\\\\"x\"");
  });
});

describe("mergeShellExportBlock", () => {
  it("replaces a Leadbay-managed export block so reinstall refreshes the token", () => {
    const existing = [
      "alias ll=\"ls -la\"",
      "# Added by leadbay-mcp install",
      "export LEADBAY_TOKEN=\"old-token\"",
      "export LEADBAY_REGION=\"us\"",
      "export LEADBAY_TELEMETRY_ENABLED=\"true\"",
      "",
    ].join("\n");
    const merged = mergeShellExportBlock(existing, buildShellExportBlock("new-token", "fr", false, false));
    expect(merged.changed).toBe(true);
    expect(merged.content).toContain("alias ll=\"ls -la\"");
    expect(merged.content).toContain("export LEADBAY_TOKEN=\"new-token\"");
    expect(merged.content).not.toContain("old-token");
    expect(merged.content).toContain("export LEADBAY_MCP_WRITE=\"0\"");
  });

  it("leaves unmanaged LEADBAY_TOKEN exports alone", () => {
    const merged = mergeShellExportBlock("export LEADBAY_TOKEN=\"manual\"\n", buildShellExportBlock("new", "us", true, true));
    expect(merged.changed).toBe(false);
    expect(merged.content).toBe("export LEADBAY_TOKEN=\"manual\"\n");
  });
});

describe("mergeCodexConfig", () => {
  it("appends the Leadbay block to an existing Codex config", () => {
    const existing = "model = \"gpt-5-codex\"\n";
    const merged = mergeCodexConfig(existing, buildCodexConfigBlock(true, true, "0.13"));
    expect(merged).toContain("model = \"gpt-5-codex\"");
    expect(merged).toContain("[mcp_servers.leadbay]");
  });

  it("replaces an existing Leadbay block instead of duplicating it", () => {
    const existing = [
      "model = \"gpt-5-codex\"",
      "",
      "[mcp_servers.leadbay]",
      "command = \"old\"",
      "args = [\"old\"]",
      "",
      "[profiles.work]",
      "approval_policy = \"on-request\"",
      "",
    ].join("\n");
    const merged = mergeCodexConfig(existing, buildCodexConfigBlock(false, false, "0.13"));
    expect(merged.match(/\[mcp_servers\.leadbay\]/g)).toHaveLength(1);
    expect(merged).not.toContain("command = \"old\"");
    expect(merged).toContain("[profiles.work]");
    expect(merged).toContain("\"LEADBAY_MCP_WRITE\"");
  });
});
