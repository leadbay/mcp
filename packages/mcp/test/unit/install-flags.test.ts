/**
 * Install argv contract — buildClaudeCodeAddArgs.
 *
 * Pins three things the user-visible behavior of `leadbay-mcp install` depends on:
 *   1. --scope user (Ludo's #3504 third complaint — global registration)
 *   2. The npx version pin tracks the @leadbay/mcp release line
 *   3. Default install is writes-on (no LEADBAY_MCP_WRITE in env);
 *      --no-write flips to LEADBAY_MCP_WRITE=0
 */
import { describe, it, expect } from "vitest";
import { buildClaudeCodeAddArgs, buildClaudeCodeRemoveArgs } from "../../src/bin.js";

describe("buildClaudeCodeAddArgs — Claude Code registration argv", () => {
  it("includes --scope user (so Leadbay is visible from any project)", () => {
    const args = buildClaudeCodeAddArgs("tok", "us", true, true);
    const idx = args.indexOf("--scope");
    expect(idx).toBeGreaterThan(0);
    expect(args[idx + 1]).toBe("user");
  });

  it("registers the leadbay server name", () => {
    const args = buildClaudeCodeAddArgs("tok", "us", true, true);
    expect(args.slice(0, 3)).toEqual(["mcp", "add", "leadbay"]);
  });

  it("emits the token and region as --env pairs", () => {
    const args = buildClaudeCodeAddArgs("tok-abc", "fr", true, true);
    expect(args).toContain("LEADBAY_TOKEN=tok-abc");
    expect(args).toContain("LEADBAY_REGION=fr");
  });

  it("always emits LEADBAY_TELEMETRY_ENABLED so MCP-client UIs render it as a toggle", () => {
    const onArgs = buildClaudeCodeAddArgs("tok", "us", true, true);
    expect(onArgs).toContain("LEADBAY_TELEMETRY_ENABLED=true");
    const offArgs = buildClaudeCodeAddArgs("tok", "us", true, false);
    expect(offArgs).toContain("LEADBAY_TELEMETRY_ENABLED=false");
  });

  it("default (includeWrite=true) does NOT inject LEADBAY_MCP_WRITE — relies on the new default", () => {
    const args = buildClaudeCodeAddArgs("tok", "us", true, true);
    expect(args.some((a) => a.startsWith("LEADBAY_MCP_WRITE"))).toBe(false);
  });

  it("--no-write (includeWrite=false) injects LEADBAY_MCP_WRITE=0", () => {
    const args = buildClaudeCodeAddArgs("tok", "us", false, true);
    expect(args).toContain("LEADBAY_MCP_WRITE=0");
  });

  it("uses @leadbay/mcp@latest npx target", () => {
    const args = buildClaudeCodeAddArgs("tok", "us", true, true);
    const sep = args.indexOf("--");
    expect(sep).toBeGreaterThan(0);
    expect(args.slice(sep + 1)).toEqual(["npx", "-y", "-p", "@leadbay/mcp@latest", "leadbay-mcp"]);
  });

  it("token and region are NOT placed after the `--` separator (would be passed to npx, not claude)", () => {
    const args = buildClaudeCodeAddArgs("tok", "us", true, true);
    const sep = args.indexOf("--");
    const afterSep = args.slice(sep + 1);
    expect(afterSep.some((a) => a.includes("LEADBAY_TOKEN"))).toBe(false);
    expect(afterSep.some((a) => a.includes("LEADBAY_REGION"))).toBe(false);
  });
});


describe("buildClaudeCodeRemoveArgs", () => {
  it("removes the user-scoped leadbay server before re-adding it", () => {
    expect(buildClaudeCodeRemoveArgs()).toEqual(["mcp", "remove", "leadbay", "--scope", "user"]);
  });
});
