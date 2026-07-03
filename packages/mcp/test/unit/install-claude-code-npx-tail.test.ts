/**
 * Regression for product#3847 — Claude Code install failing with a misleading
 * `unknown option '--scope'` / `--env`.
 *
 * The `claude mcp add` subprocess tail must satisfy TWO constraints at once:
 *
 *  1. No SHORT `-p` flag. Even after the `--` separator, `-p` leaks back into
 *     Claude Code's own Commander parser on current CLIs, which then rejects an
 *     earlier option (`--scope`/`--env`) with a confusing `unknown option`
 *     error — the install aborts at `claude mcp add` time.
 *
 *  2. The package MUST still be flagged (`--package=…`) AND the `leadbay-mcp`
 *     bin named explicitly. @leadbay/mcp declares several bins and none is
 *     named `mcp`, so a bare `npx -y @leadbay/mcp@latest` (with or without a
 *     trailing bin) can't be resolved by npx — it dies at LAUNCH with
 *     `could not determine executable to run`, even though `claude mcp add`
 *     itself succeeded.
 *
 * The `=`-joined long form `--package=@leadbay/mcp@latest` is the shape that
 * satisfies both. This test pins it and guards against a `-p` regression.
 *
 * New file — no existing test is modified.
 */
import { describe, it, expect } from "vitest";
import { buildClaudeCodeAddArgs } from "../../installer/install-claude-code.js";

describe("buildClaudeCodeAddArgs — subprocess tail (product#3847)", () => {
  it("post-`--` tail is exactly `npx -y --package=@leadbay/mcp@latest leadbay-mcp`", () => {
    const args = buildClaudeCodeAddArgs("tok", "us", true, true);
    const sep = args.indexOf("--");
    expect(args.slice(sep + 1)).toEqual([
      "npx",
      "-y",
      "--package=@leadbay/mcp@latest",
      "leadbay-mcp",
    ]);
  });

  it("carries no bare `-p` short flag after the separator (would break the parser)", () => {
    const args = buildClaudeCodeAddArgs("tok", "us", true, true);
    const tail = args.slice(args.indexOf("--") + 1);
    expect(tail).not.toContain("-p");
  });

  it("flags the package AND names the leadbay-mcp bin (so npx can launch it)", () => {
    const args = buildClaudeCodeAddArgs("tok", "us", true, true);
    const tail = args.slice(args.indexOf("--") + 1);
    // Package must be flagged (bare `@leadbay/mcp@latest` as the command is
    // unresolvable) and the explicit bin present (no bin is named `mcp`).
    expect(tail.some((a) => a.startsWith("--package=@leadbay/mcp@"))).toBe(true);
    expect(tail).toContain("leadbay-mcp");
  });

  it("localBinPath dev override still uses `-- node <path>` (no npx, no -p)", () => {
    const args = buildClaudeCodeAddArgs("tok", "us", true, true, "/abs/dist/bin.js");
    const sep = args.indexOf("--");
    expect(args.slice(sep + 1)).toEqual(["node", "/abs/dist/bin.js"]);
  });
});
