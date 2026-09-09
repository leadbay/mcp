// The Claude Code / Cowork plugin manifest carries its own version and its own
// copy of the connector URL. Both drifted silently before: the manifest sat at
// 0.29.0 with an `@leadbay/mcp@0.29` npx pin for seven releases while
// packages/mcp shipped 0.36.0, because nothing checked it. server.json has
// server-json-version.test.ts; this is the same guard for the plugin.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const readJson = (...parts: string[]) =>
  JSON.parse(readFileSync(join(REPO_ROOT, ...parts), "utf8"));

const PLUGIN = [".claude-plugin", "plugins", "leadbay", ".claude-plugin", "plugin.json"];
const HOSTED_MCP_URL = "https://mcp.leadbay.app/mcp";

describe("claude-code plugin manifest", () => {
  it("version tracks packages/mcp/package.json", () => {
    const pkg = readJson("packages", "mcp", "package.json");
    const plugin = readJson(...PLUGIN);
    expect(plugin.version).toBe(pkg.version);
  });

  it("points at the hosted OAuth connector, not a pinned npx package", () => {
    const plugin = readJson(...PLUGIN);
    const server = plugin.mcpServers?.leadbay;
    expect(server).toBeDefined();
    expect(server.type).toBe("http");
    expect(server.url).toBe(HOSTED_MCP_URL);
    // A `command`/`args` pair would reintroduce the version pin that rotted.
    expect(server.command).toBeUndefined();
    expect(server.args).toBeUndefined();
  });

  it("asks the user for no credentials — OAuth happens in the host", () => {
    const plugin = readJson(...PLUGIN);
    // A directory plugin must never prompt for a pasted bearer token.
    expect(plugin.userConfig ?? {}).toEqual({});
    expect(JSON.stringify(plugin)).not.toMatch(/LEADBAY_TOKEN/);
  });

  it("the marketplace entry resolves to that plugin directory", () => {
    const market = readJson(".claude-plugin", "marketplace.json");
    const entry = market.plugins.find((p: { name: string }) => p.name === "leadbay");
    expect(entry).toBeDefined();
    expect(entry.source).toBe("./.claude-plugin/plugins/leadbay");
  });
});
