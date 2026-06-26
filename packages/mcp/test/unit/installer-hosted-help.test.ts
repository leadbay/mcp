/**
 * Test for the installer's hosted-MCP fallback message (#3805). The guided
 * installer always tries to open a browser; this block is printed only by the
 * entrypoint watchdog when nothing opened in time. It must surface BOTH
 * no-local-browser paths to the hosted MCP: the Claude web / Cowork web
 * Connectors UI, and the `claude mcp add` CLI command.
 *
 * New file (existing installer tests are left untouched).
 */
import { describe, it, expect } from "vitest";
import { printHostedMcpHelp, HOSTED_MCP_URL } from "../../installer/install-shared.js";

describe("printHostedMcpHelp — hosted-MCP fallback block", () => {
  it("includes the hosted MCP URL", () => {
    let out = "";
    printHostedMcpHelp((s) => { out += s; });
    expect(out).toContain(HOSTED_MCP_URL);
  });

  it("documents the Claude web / Cowork web Connectors path", () => {
    let out = "";
    printHostedMcpHelp((s) => { out += s; });
    expect(out).toMatch(/Connectors/);
    expect(out).toMatch(/custom connector/i);
  });

  it("documents the CLI and terminal install fallbacks", () => {
    let out = "";
    printHostedMcpHelp((s) => { out += s; });
    expect(out).toContain("claude mcp add --transport http leadbay");
    expect(out).toContain("install --oauth");
  });
});
