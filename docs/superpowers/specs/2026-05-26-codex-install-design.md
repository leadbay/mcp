# Design: Add Codex to `leadbay-mcp install`

Date: 2026-05-26
Issue: https://github.com/leadbay/product/issues/3651

## Summary

Extend the existing `leadbay-mcp install` command to detect and configure OpenAI Codex CLI
alongside the three existing clients (Claude Code, Claude Desktop, Cursor). Codex uses the
same stdio transport as all other clients — `npx -y @leadbay/mcp` — but its config format
is TOML (`~/.codex/config.toml`) and it needs `LEADBAY_TOKEN` exported in the shell env at
launch time. The install command will handle both: write the TOML block and append the
`export` lines to the user's shell rc files.

## What changes

### 1. Codex detection — `detectClients()`

Detect Codex the same way Claude Code is detected: try `which codex` (unix) / `where codex`
(Windows). If the binary is found, also check for `~/.codex/` directory as a confirmation.
Add a new `id: "codex"` entry to the `DetectedClient` union.

Config path per platform:
- Linux/macOS: `~/.codex/config.toml`
- Windows: `%USERPROFILE%\.codex\config.toml`

### 2. Codex config writer — `installInCodexConfig()`

New function. Reads `~/.codex/config.toml` (or starts fresh), merges the `[mcp_servers.leadbay]`
block, writes back. Uses the same atomic write pattern (`.tmp` → rename) as `installInJsonConfig`.

TOML block written:

```toml
[mcp_servers.leadbay]
command = "npx"
args = ["-y", "@leadbay/mcp@<VERSION>"]
env_vars = ["LEADBAY_TOKEN", "LEADBAY_REGION", "LEADBAY_TELEMETRY_ENABLED"]
```

If `includeWrite=false`, also forward `LEADBAY_MCP_WRITE`.

Note: no TOML library needed — the block is small and self-contained. We write it as a string
merge: read existing file, strip any existing `[mcp_servers.leadbay]` block (regex), append
the new block. This avoids adding a TOML parser dependency.

### 3. Shell rc export — `appendShellExports()`

New function. Called after a successful Codex install. Appends `export LEADBAY_TOKEN=xxx` and
`export LEADBAY_REGION=xxx` to:
- `~/.zshrc` if it exists
- `~/.bashrc` if it exists
- `~/.profile` as fallback (always, if neither exists)

On Windows: sets the user-level env var via `setx LEADBAY_TOKEN xxx` (no shell rc).

Guards:
- If the file already contains `LEADBAY_TOKEN=`, skip (don't duplicate).
- Appends a comment `# Added by leadbay-mcp install` before the block.
- Prints which files were updated so the user knows to `source` or restart their shell.

### 4. `install` summary output

Codex appears in the summary table alongside the other clients:

```
=== install summary (leadbay-mcp@0.x.x) ===
  ✓ Claude Code      registered
  ✓ Claude Desktop   registered
  ✓ Cursor           registered
  ✓ Codex            registered (~/.codex/config.toml + ~/.zshrc exported)
```

## What does NOT change

- `login` command — untouched
- Existing Claude Code / Claude Desktop / Cursor install paths — untouched
- HTTP server (`leadbay-mcp-http`) — unaffected
- `--target` flag — works as-is, user can pass `--target codex` to only install Codex
- `--yes` flag — skips confirmation prompt for Codex too

## Files touched

- `packages/mcp/src/bin.ts` — all changes land here:
  - `detectClients()`: add Codex branch
  - `installInCodexConfig()`: new function
  - `appendShellExports()`: new function
  - `runInstall()`: call the two new functions for `c.id === "codex"`

## Testing

- Unit test `installInCodexConfig()` with an empty file and a pre-existing config (no duplicate block).
- Unit test `appendShellExports()` — idempotency (don't write twice if already present).
- Existing `buildClaudeCodeAddArgs` tests unchanged.
- Add `codex` to the `DetectedClient` id union type — TypeScript exhaustiveness catches any switch misses.
