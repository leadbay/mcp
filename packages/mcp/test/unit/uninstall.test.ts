import { describe, it, expect } from "vitest";
import {
  stripShellExportBlock,
  stripCodexBlock,
  stripJsonMcpEntry,
} from "../../src/bin.js";

describe("stripShellExportBlock", () => {
  it("removes the managed block written by install", () => {
    const existing = [
      "alias ll=\"ls -la\"",
      "# Added by leadbay-mcp install",
      "export LEADBAY_TOKEN=\"old-token\"",
      "export LEADBAY_REGION=\"us\"",
      "export LEADBAY_TELEMETRY_ENABLED=\"true\"",
      "",
    ].join("\n");
    const { content, changed } = stripShellExportBlock(existing);
    expect(changed).toBe(true);
    expect(content).toContain("alias ll");
    expect(content).not.toContain("LEADBAY_TOKEN");
    expect(content).not.toContain("Added by leadbay-mcp install");
  });

  it("removes the managed block that includes LEADBAY_MCP_WRITE", () => {
    const existing = [
      "# Added by leadbay-mcp install",
      "export LEADBAY_TOKEN=\"tok\"",
      "export LEADBAY_REGION=\"fr\"",
      "export LEADBAY_TELEMETRY_ENABLED=\"false\"",
      "export LEADBAY_MCP_WRITE=\"0\"",
      "",
    ].join("\n");
    const { content, changed } = stripShellExportBlock(existing);
    expect(changed).toBe(true);
    expect(content).not.toContain("LEADBAY_TOKEN");
    expect(content).not.toContain("LEADBAY_MCP_WRITE");
  });

  it("leaves unmanaged LEADBAY_TOKEN exports untouched", () => {
    const existing = "export LEADBAY_TOKEN=\"manual\"\n";
    const { content, changed } = stripShellExportBlock(existing);
    expect(changed).toBe(false);
    expect(content).toBe(existing);
  });

  it("returns changed=false when no managed block is present", () => {
    const existing = "alias ll=\"ls -la\"\n";
    const { changed } = stripShellExportBlock(existing);
    expect(changed).toBe(false);
  });
});

describe("stripCodexBlock", () => {
  it("removes the leadbay TOML block", () => {
    const existing = [
      "model = \"gpt-5-codex\"",
      "",
      "[mcp_servers.leadbay]",
      "command = \"npx\"",
      "args = [\"-y\", \"@leadbay/mcp@0.13\"]",
      "env_vars = [\"LEADBAY_TOKEN\", \"LEADBAY_REGION\", \"LEADBAY_TELEMETRY_ENABLED\"]",
      "",
    ].join("\n");
    const { content, changed } = stripCodexBlock(existing);
    expect(changed).toBe(true);
    expect(content).toContain("model =");
    expect(content).not.toContain("[mcp_servers.leadbay]");
    expect(content).not.toContain("LEADBAY_TOKEN");
  });

  it("leaves other TOML sections intact", () => {
    const existing = [
      "[mcp_servers.leadbay]",
      "command = \"npx\"",
      "",
      "[profiles.work]",
      "approval_policy = \"on-request\"",
      "",
    ].join("\n");
    const { content, changed } = stripCodexBlock(existing);
    expect(changed).toBe(true);
    expect(content).toContain("[profiles.work]");
    expect(content).not.toContain("[mcp_servers.leadbay]");
  });

  it("returns changed=false when block is absent", () => {
    const existing = "model = \"gpt-5-codex\"\n";
    const { changed } = stripCodexBlock(existing);
    expect(changed).toBe(false);
  });

  it("leaves an empty file clean when only the leadbay block existed", () => {
    const existing = [
      "[mcp_servers.leadbay]",
      "command = \"npx\"",
      "",
    ].join("\n");
    const { content, changed } = stripCodexBlock(existing);
    expect(changed).toBe(true);
    expect(content.trim()).toBe("");
  });
});

describe("stripJsonMcpEntry", () => {
  it("removes the leadbay key from mcpServers", () => {
    const existing = JSON.stringify(
      {
        mcpServers: {
          leadbay: { command: "npx", args: ["-y", "@leadbay/mcp@0.13"], env: { LEADBAY_TOKEN: "tok" } },
          other: { command: "foo" },
        },
      },
      null,
      2
    ) + "\n";
    const { content, changed } = stripJsonMcpEntry(existing);
    expect(changed).toBe(true);
    const parsed = JSON.parse(content);
    expect(parsed.mcpServers.leadbay).toBeUndefined();
    expect(parsed.mcpServers.other).toBeDefined();
  });

  it("returns changed=false when leadbay is not present", () => {
    const existing = JSON.stringify({ mcpServers: { other: { command: "foo" } } }, null, 2) + "\n";
    const { changed } = stripJsonMcpEntry(existing);
    expect(changed).toBe(false);
  });

  it("returns changed=false when mcpServers is absent", () => {
    const existing = JSON.stringify({ someOtherKey: true }, null, 2) + "\n";
    const { changed } = stripJsonMcpEntry(existing);
    expect(changed).toBe(false);
  });

  it("returns changed=false and original content on invalid JSON", () => {
    const existing = "not json {";
    const { content, changed } = stripJsonMcpEntry(existing);
    expect(changed).toBe(false);
    expect(content).toBe(existing);
  });
});
