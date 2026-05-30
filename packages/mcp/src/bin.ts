import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  createClient,
  createDefaultBulkStore,
  formatLoginError,
  resolveRegion,
  type CreateClientConfig,
  LeadbayClient,
  type LeadbayError,
  type ToolLogger,
} from "@leadbay/core";
import { buildServer } from "./server.js";
import {
  detectClients,
  detectClaudeDesktopMode,
  formatInstallOsLabel,
  HOSTED_MCP_URL,
  type DetectedClient,
} from "../installer/install-shared.js";
export { detectClaudeDesktopMode, formatInstallOsLabel } from "../installer/install-shared.js";
export {
  buildClaudeCodeAddArgs,
  buildClaudeCodeRemoveArgs,
  installInClaudeCode,
  isLeadbayConfiguredInClaudeCode,
  uninstallFromClaudeCode,
} from "../installer/install-claude-code.js";
export {
  installInJsonConfig,
  stripJsonMcpEntry,
  uninstallFromJsonConfig,
} from "../installer/install-json-config.js";
export {
  buildCodexConfigBlock,
  buildShellExportBlock,
  mergeCodexConfig,
  mergeShellExportBlock,
  stripCodexBlock,
  stripShellExportBlock,
  installInCodexConfig,
  appendShellExports,
  uninstallFromCodexConfig,
  uninstallShellExports,
} from "../installer/install-codex.js";
export { removeDxtExtension } from "../installer/install-dxt.js";
export { parseInstallSelection, readChoice, updateInstallWizardState } from "../installer/install-wizard.js";
import { installInClaudeCode } from "../installer/install-claude-code.js";
import { installInJsonConfig } from "../installer/install-json-config.js";
import { installInCodexConfig, appendShellExports } from "../installer/install-codex.js";
import { removeDxtExtension } from "../installer/install-dxt.js";
import { chooseInstallClients, readChoice } from "../installer/install-wizard.js";
import { makeBrokenClient, type AuthState, type ResolvedClient } from "./broken-client.js";
import { parseWriteEnv } from "./env.js";
import { initTelemetry } from "./telemetry.js";
import { createDefaultUpdateStateStore } from "./update-state.js";
import { checkForUpdate, recordRunningVersion } from "./update-check.js";
import { oauthLogin, inferRegionViaStargate } from "./oauth.js";

// Regional OAuth base URLs. Production is the default path; staging remains
// available for `login --oauth --staging` and staging MCPB validation.
const OAUTH_BASE_URLS = {
  prod: {
    us: "https://api-us.leadbay.app",
    fr: "https://api-fr.leadbay.app",
  },
  staging: {
    us: "https://api-us-staging.leadbay.app",
    fr: "https://staging.api.leadbay.app",
  },
} as const;

// __LEADBAY_MCP_VERSION__ is replaced at build time by tsup with the string
// literal from packages/mcp/package.json#version. Single source of truth —
// bump package.json and both the tarball and --version output track it.
declare const __LEADBAY_MCP_VERSION__: string;
const VERSION = __LEADBAY_MCP_VERSION__;

const HELP = `
leadbay-mcp ${VERSION} — Leadbay Model Context Protocol server

USAGE
  leadbay-mcp            Run the MCP stdio server (for Claude Desktop, Cursor, etc.)
  leadbay-mcp installer              Open the guided Electron installer wizard.
  leadbay-mcp installer --uninstall  Open the guided Electron uninstaller wizard.
  installer                          Same installer wizard via the short npm bin
                                     (npx -y -p @leadbay/mcp@latest installer).
  leadbay-mcp-installer              Same installer wizard via the explicit npm bin.
  leadbay-mcp install --oauth
                         One-shot setup: browser OAuth AND register the MCP server with
                         your installed MCP clients (Claude Code / Claude Desktop /
                         Cursor / Codex). Auto-detects which clients are installed; you confirm
                         before each write. Credentials never land in terminal scrollback.
                         Run this first if you're getting started.
  leadbay-mcp login --oauth
                         Lower-level: authenticate only (no auto-install).
                         Use when you want to copy the credential into a config file
                         yourself.
  leadbay-mcp doctor     Validate your token, probe your region, print account + quota.
  leadbay-mcp --version  Print version
  leadbay-mcp --help     Print this help

ENV VARS
  LEADBAY_TOKEN          (required) Bearer token (run \`leadbay-mcp install\` to mint one).
  LEADBAY_REGION         (optional) "us" or "fr". Auto-detected from /users/me if unset.
  LEADBAY_BASE_URL       (optional) Override API base URL (for staging/dev).
  LEADBAY_MCP_ADVANCED   (optional) Set to "1" to expose granular API tools alongside
                         the composite workflow tools. Most users don't need this.
  LEADBAY_MCP_WRITE      (optional) Default "1" (ON) since 0.3.0: exposes write composites
                         (refine_prompt, report_outreach, adjust_audience, bulk_qualify_leads,
                         enrich_titles, answer_clarification, import_leads). Set to "0" /
                         "false" / "no" / "off" for read-only mode. Note: in 0.2.x, only
                         "1" turned writes ON; "true" / "yes" / "on" were treated as OFF.
                         The 0.3.0 parser accepts all those values as truthy. See MIGRATION.md.
  LEADBAY_MOCK           (optional) Set to "1" to serve all responses from on-disk fixtures
                         (no network, no real auth). Useful for agent-author dry-running.
                         GETs are matched against fixture JSON files; POSTs/DELETEs are
                         journaled in-process and return {mocked: true, would_call: {...}}.
  LEADBAY_MOCK_DIR       (optional) Fixture directory. Default: ./.context/leadbay-live-shapes/
  LEADBAY_LOG_LEVEL      (optional) "debug" | "info" | "error" (default "error"). Logs to stderr.
  LEADBAY_TELEMETRY_ENABLED  (optional) Default "true". Sends product usage events
                         (tool name, duration, ok flag, error code) to PostHog and
                         unexpected errors to Sentry, helping Leadbay improve the MCP.
                         Events are tied to your Leadbay account email (so MCP usage
                         consolidates with web-app usage in our analytics). Tool
                         arguments, response bodies, and lead PII are NEVER captured.
                         Set to "false" to opt out. See README "Privacy & telemetry".

EXAMPLE Claude Desktop config (~/Library/Application Support/Claude/claude_desktop_config.json)
  {
    "mcpServers": {
      "leadbay": {
        "command": "npx",
        "args": ["-y", "@leadbay/mcp@latest"],
        "env": {
          "LEADBAY_TOKEN": "lb_...",
          "LEADBAY_REGION": "us",
          "LEADBAY_TELEMETRY_ENABLED": "true"
        }
      }
    }
  }

DOCS
  https://github.com/leadbay/leadclaw#readme
`.trim();

type LogLevel = "debug" | "info" | "error";
function makeStderrLogger(level: LogLevel): ToolLogger {
  const rank: Record<LogLevel, number> = { debug: 0, info: 1, error: 2 };
  const threshold = rank[level] ?? rank.error;
  return {
    info: (m: string) => {
      if (rank.info >= threshold) process.stderr.write(`[leadbay-mcp info] ${m}\n`);
    },
    warn: (m: string) => {
      if (rank.info >= threshold) process.stderr.write(`[leadbay-mcp warn] ${m}\n`);
    },
    error: (m: string) => {
      process.stderr.write(`[leadbay-mcp error] ${m}\n`);
    },
  };
}

function parseLogLevel(raw: string | undefined): LogLevel {
  if (raw === "debug" || raw === "info") return raw;
  return "error";
}

// Token-missing handler for CLI subcommands (doctor, etc.). Interactive
// commands SHOULD print to stderr and exit non-zero — the user typed the
// command, they're watching the terminal, and a hard exit is the
// expected UX. The MCP stdio mode in resolveClientFromEnv takes the
// opposite tack (broken-client + keep running) because the user there
// isn't watching a terminal; they're watching a "Server disconnected"
// banner with no diagnostic.
function exitWithTokenError(): never {
  process.stderr.write(
    "leadbay-mcp: LEADBAY_TOKEN environment variable is required.\n" +
      "  1. Run: npx -y @leadbay/mcp install --oauth\n" +
      "  2. Set it in your MCP client config (e.g. claude_desktop_config.json).\n" +
      "\n" +
      "Run `leadbay-mcp --help` for the full config template.\n"
  );
  process.exit(1);
}

// "Auth state" — describes the outcome of resolveClientFromEnv. The MCP
// server always boots; auth errors surface as tool-call errors against a
// AuthState / ResolvedClient / makeBrokenClient live in broken-client.ts so
// auth-http.ts can import them without pulling in the full CLI entrypoint.
export type { AuthState, ResolvedClient } from "./broken-client.js";
export { makeBrokenClient } from "./broken-client.js";

// Try to populate LEADBAY_TOKEN / REGION / BASE_URL from the on-disk
// credentials file (the one OAuth bootstrap writes). When the MCP server is
// launched by Claude Desktop's .mcpb install without any pre-set env, this
// lets the second run (and every run after) skip the OAuth dance entirely.
//
// Returns true when env was populated from disk.
function hydrateEnvFromCredentialsFile(): boolean {
  if (process.env.LEADBAY_TOKEN) return false;
  try {
    const { existsSync, readFileSync } = require_("node:fs") as typeof import("node:fs");
    const { path } = resolveOAuthBootstrapCredentialsPath();
    if (!existsSync(path)) return false;
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    const env = parsed?.mcpServers?.leadbay?.env;
    if (!env || typeof env !== "object") return false;
    if (typeof env.LEADBAY_TOKEN === "string" && env.LEADBAY_TOKEN.length > 0) {
      process.env.LEADBAY_TOKEN = env.LEADBAY_TOKEN;
    }
    if (!process.env.LEADBAY_REGION && typeof env.LEADBAY_REGION === "string") {
      process.env.LEADBAY_REGION = env.LEADBAY_REGION;
    }
    if (!process.env.LEADBAY_BASE_URL && typeof env.LEADBAY_BASE_URL === "string") {
      process.env.LEADBAY_BASE_URL = env.LEADBAY_BASE_URL;
    }
    return !!process.env.LEADBAY_TOKEN;
  } catch {
    return false;
  }
}

function resolveOAuthBootstrapCredentialsPath(): { path: string; legacy: boolean } {
  const resolved = resolveDefaultCredentialsPath();
  if (process.env.LEADBAY_OAUTH_STAGING !== "1") return resolved;
  const { dirname, join } = require_("node:path") as typeof import("node:path");
  return {
    path: join(dirname(resolved.path), "credentials.staging.json"),
    legacy: resolved.legacy,
  };
}

// OAuth bootstrap: when an MCPB opts in with LEADBAY_OAUTH_BOOTSTRAP=1 and no
// token is available from env or disk, run the browser-loopback OAuth flow
// inline so the server can come up authenticated. This is what makes the .mcpb
// install a "click Install -> click Allow in browser -> done" experience
// instead of "go run a CLI first".
//
// Region/auth-server resolution priority:
//   1. LEADBAY_BASE_URL env -> use it directly (escape hatch / persisted config)
//   2. LEADBAY_REGION env -> map to prod or staging regional URL
//   3. stargate /user_info -> GeoIP-detect, map to prod or staging regional URL
async function bootstrapOAuthIfMissing(logger: ToolLogger): Promise<boolean> {
  if (process.env.LEADBAY_TOKEN) return false;

  const { hostname } = await import("node:os");
  process.stderr.write(
    `\n[leadbay-mcp@${VERSION}] No token found — starting OAuth login in your browser…\n` +
      `  (This is a one-time setup. The resulting token will be persisted at\n` +
      `   ${(() => { try { return resolveOAuthBootstrapCredentialsPath().path; } catch { return "<credentials file>"; } })()}\n` +
      `   so subsequent launches start instantly.)\n\n`
  );

  // Pick the auth-server base URL.
  const envBaseUrl = process.env.LEADBAY_BASE_URL;
  const envRegion = process.env.LEADBAY_REGION;
  const isStaging =
    process.env.LEADBAY_OAUTH_STAGING === "1" ||
    (!!envBaseUrl && /staging/.test(envBaseUrl));
  let region: "us" | "fr";
  let authServerBaseUrl: string;

  try {
    if (envBaseUrl) {
      // Explicit base URL wins — derive region for the persisted record.
      authServerBaseUrl = envBaseUrl;
      region = /(-fr|staging\.api)/.test(envBaseUrl) ? "fr" : "us";
    } else if (envRegion === "us" || envRegion === "fr") {
      region = envRegion;
      authServerBaseUrl = OAUTH_BASE_URLS[isStaging ? "staging" : "prod"][region];
    } else {
      region = await inferRegionViaStargate({ staging: isStaging });
      authServerBaseUrl = OAUTH_BASE_URLS[isStaging ? "staging" : "prod"][region];
    }

    const { accessToken } = await oauthLogin({
      authServerBaseUrl,
      clientName: `Leadbay MCP @ ${hostname()}`,
      log: (m) => process.stderr.write(m),
    });

    // Persist to ~/.config/leadbay/credentials.json so future launches are silent.
    try {
      const { writeFileSync, mkdirSync, chmodSync } = require_("node:fs") as typeof import("node:fs");
      const { dirname } = require_("node:path") as typeof import("node:path");
      const { path } = resolveOAuthBootstrapCredentialsPath();
      const envBlock: Record<string, string> = {
        LEADBAY_TOKEN: accessToken,
        LEADBAY_REGION: region,
      };
      if (isStaging || envBaseUrl) envBlock.LEADBAY_BASE_URL = authServerBaseUrl;
      const config = {
        mcpServers: {
          leadbay: {
            command: "npx",
            args: ["-y", `@leadbay/mcp@${VERSION.split(".").slice(0, 2).join(".")}`],
            env: envBlock,
          },
        },
      };
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
      try { chmodSync(path, 0o600); } catch { /* FAT32 etc. */ }
      process.stderr.write(`[leadbay-mcp] Persisted credentials to ${path}\n`);
    } catch (err: any) {
      process.stderr.write(
        `[leadbay-mcp warn] OAuth succeeded but persisting the token failed (${err?.message ?? err}). ` +
          `You'll be prompted to re-authorize on next launch.\n`
      );
    }

    process.env.LEADBAY_TOKEN = accessToken;
    process.env.LEADBAY_REGION = region;
    if (isStaging || envBaseUrl) process.env.LEADBAY_BASE_URL = authServerBaseUrl;
    logger.info?.(`OAuth bootstrap complete — region=${region}`);
    return true;
  } catch (err: any) {
    process.stderr.write(
      `[leadbay-mcp] OAuth bootstrap failed: ${err?.message ?? err}\n` +
        `  The server will start but tools will return AUTH_MISSING until you authorize.\n`
    );
    return false;
  }
}

export async function resolveClientFromEnv(logger: ToolLogger): Promise<ResolvedClient> {
  if (process.env.LEADBAY_OAUTH_BOOTSTRAP === "1") {
    hydrateEnvFromCredentialsFile();
    if (!process.env.LEADBAY_TOKEN) {
      await bootstrapOAuthIfMissing(logger);
    }
  }

  const token = process.env.LEADBAY_TOKEN;
  if (!token) {
    if (process.env.LEADBAY_OAUTH_BOOTSTRAP === "1") {
      process.stderr.write(
        "leadbay-mcp: OAuth authorization is required but no token is available.\n" +
          "  Restart the Claude Desktop extension to authorize Leadbay in your browser.\n" +
          "\n" +
          "Run `leadbay-mcp --help` for the full config template.\n"
      );
      const regionEnv = process.env.LEADBAY_REGION;
      const region: "us" | "fr" = regionEnv === "fr" ? "fr" : "us";
      return {
        client: makeBrokenClient(
          {
            error: true,
            code: "AUTH_MISSING",
            message: "Leadbay OAuth authorization has not completed.",
            hint: "Restart the Claude Desktop extension and complete the Leadbay OAuth browser authorization.",
          },
          region
        ),
        authState: "missing",
      };
    }
    // Don't process.exit — Claude Desktop / Cursor would surface this as
    // "Server disconnected" with no actionable info. Return a broken
    // client so the server still answers `initialize` + `tools/list`,
    // and the first tool call returns this AUTH_MISSING envelope which
    // the agent can render to the user.
    process.stderr.write(
      "leadbay-mcp: LEADBAY_TOKEN environment variable is required.\n" +
        "  1. Run: npx -y @leadbay/mcp install --oauth\n" +
        "  2. Set it in your MCP client config (e.g. claude_desktop_config.json).\n" +
        "\n" +
        "Run `leadbay-mcp --help` for the full config template.\n"
    );
    const regionEnv = process.env.LEADBAY_REGION;
    const region: "us" | "fr" = regionEnv === "fr" ? "fr" : "us";
    return {
      client: makeBrokenClient(
        {
          error: true,
          code: "AUTH_MISSING",
          message: "LEADBAY_TOKEN environment variable is not set.",
          hint: "Run `npx -y @leadbay/mcp install --oauth` to authenticate, then set LEADBAY_TOKEN in your MCP client config.",
        },
        region
      ),
      authState: "missing",
    };
  }

  const regionEnv = process.env.LEADBAY_REGION;
  const explicitRegion: "us" | "fr" | undefined =
    regionEnv === "us" || regionEnv === "fr" ? regionEnv : undefined;
  const baseUrl = process.env.LEADBAY_BASE_URL;

  // If the user pinned a baseUrl or region, honor it exactly.
  if (baseUrl || explicitRegion) {
    const config: CreateClientConfig = { token };
    if (baseUrl) config.baseUrl = baseUrl;
    if (explicitRegion) config.region = explicitRegion;
    return { client: createClient(config), authState: "ok" };
  }

  // Auto-probe path: token gets sent to BOTH api-us.leadbay.app and
  // api-fr.leadbay.app. Lower-stakes than the password cross-leak (the wrong
  // region just 401s — the token isn't usable across tenants), but it's still
  // an info leak. Print a stderr warning that ignores LEADBAY_LOG_LEVEL so an
  // operator who relies on the default will see the recommendation to pin
  // LEADBAY_REGION.
  process.stderr.write(
    "[leadbay-mcp warn] LEADBAY_REGION is unset; probing api-us and api-fr in parallel.\n" +
      "  Your bearer token will be sent to BOTH backends. Set LEADBAY_REGION=us|fr in your\n" +
      "  MCP client config to avoid this.\n"
  );
  logger.info?.("Auto-detecting region via /users/me on us and fr...");
  const probe = async (region: "us" | "fr"): Promise<LeadbayClient> => {
    const c = createClient({ token, region });
    await c.request("GET", "/users/me");
    return c;
  };

  try {
    const client = await Promise.any([probe("us"), probe("fr")]);
    return { client, authState: "ok" };
  } catch (err: any) {
    // Both failed. The AggregateError exposes each leaf error.
    const errors: any[] = err?.errors ?? [];
    const firstAuth = errors.find(
      (e) => e?.code === "AUTH_EXPIRED" || e?.code === "NOT_AUTHENTICATED"
    );
    if (firstAuth) {
      // Don't process.exit — same reasoning as the missing-token branch
      // above. Surface AUTH_EXPIRED as a tool-call error against a
      // broken-client. Default to `us` for the base URL so the failure
      // _meta carries a sensible region tag (the token didn't work in
      // either, so there's no "right" answer here).
      process.stderr.write(
        `leadbay-mcp: ${firstAuth.message}. ${firstAuth.hint}\n` +
          "Tip: verify your LEADBAY_TOKEN is valid and, if you know your region, set LEADBAY_REGION=us or LEADBAY_REGION=fr.\n"
      );
      return {
        client: makeBrokenClient(
          {
            error: true,
            code: firstAuth.code,
            message: firstAuth.message,
            hint: "Verify your LEADBAY_TOKEN is valid. If you know your region, set LEADBAY_REGION=us or LEADBAY_REGION=fr to skip auto-probing. Authenticate again with `leadbay-mcp login --oauth`.",
          },
          "us"
        ),
        authState: "expired",
      };
    }
    // Non-auth failures (network, DNS, etc.) — fall back to us so the
    // server can still start and surface the error on first tool call.
    const firstMsg = errors[0]?.message ?? String(err);
    process.stderr.write(
      `leadbay-mcp: region auto-detection failed (${firstMsg}). Defaulting to us; set LEADBAY_REGION to skip probing.\n`
    );
    return {
      client: createClient({ token, region: "us" }),
      authState: "probe_failed",
    };
  }
}

import { createRequire } from "node:module";
function require_(mod: string): any {
  return (createRequire(import.meta.url) as any)(mod);
}

// Read a password from stdin without echoing (TTY) or from $LEADBAY_PASSWORD
// when the env var is set. Falls through to plain readline if stdin isn't a TTY
// (e.g. piped input — `echo pwd | leadbay-mcp login --email …`).
async function readPassword(): Promise<string> {
  const envPwd = process.env.LEADBAY_PASSWORD;
  if (envPwd) return envPwd;

  const isTTY = process.stdin.isTTY === true;
  if (!isTTY) {
    // Piped: read stdin to EOF.
    return await new Promise<string>((resolve) => {
      const chunks: Buffer[] = [];
      process.stdin.on("data", (c: string | Buffer) => {
        chunks.push(typeof c === "string" ? Buffer.from(c, "utf8") : c);
      });
      process.stdin.on("end", () =>
        resolve(Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, ""))
      );
    });
  }

  process.stderr.write("Password: ");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  let buf = "";
  return await new Promise<string>((resolve) => {
    const onData = (key: string) => {
      // Ctrl+C or Ctrl+D
      if (key === "\u0003" || key === "\u0004") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stderr.write("\n");
        process.exit(130);
      }
      // Enter
      if (key === "\r" || key === "\n") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", onData);
        process.stderr.write("\n");
        resolve(buf);
        return;
      }
      // Backspace
      if (key === "\u007f" || key === "\b") {
        if (buf.length > 0) buf = buf.slice(0, -1);
        return;
      }
      buf += key;
    };
    process.stdin.on("data", onData);
  });
}

function parseFlag(args: string[], name: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === `--${name}` && i + 1 < args.length) return args[i + 1];
    if (args[i].startsWith(`--${name}=`)) return args[i].slice(name.length + 3);
  }
  return undefined;
}

function hasFlag(args: string[], name: string): boolean {
  return args.some((a) => a === `--${name}`);
}

function ansi(text: string, code: string, enabled: boolean): string {
  return enabled ? `\x1b[${code}m${text}\x1b[0m` : text;
}

function isInteractiveInstall(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}


// Resolve the platform-correct default credentials path (DX-voice T3, 0.3.0).
// Order: $XDG_CONFIG_HOME → macOS Application Support → %APPDATA% → ~/.config.
// Backward-compat: if 0.2.x's ~/.leadbay-mcp.json already exists, use that
// path on this run with a deprecation note pointing at the new path.
export function resolveDefaultCredentialsPath(): { path: string; legacy: boolean } {
  const fs = require_("node:fs");
  const path = require_("node:path");
  const legacyPath = path.join(require_("node:os").homedir(), ".leadbay-mcp.json");
  if (fs.existsSync(legacyPath)) {
    return { path: legacyPath, legacy: true };
  }
  return { path: computeFreshDefaultPath(), legacy: false };
}

// Pure decision: should `runLogin` refuse to overwrite `existingConfig` when
// the user is logging in as `email`/`region`? Returns null when overwrite is
// safe; returns a string reason when it should be refused.
//
// Identity = (email, region). Token equality is intentionally NOT checked —
// every loginAt() mints a fresh token, so token-equality would always fire.
// 0.2.x configs without an `email` field fall through to "safe" (the user
// clearly wants to refresh whatever account that file holds — CLI gives no
// other identity signal).
export function checkLoginCollision(
  existingConfig: unknown,
  email: string | undefined,
  region: "us" | "fr"
): string | null {
  if (!existingConfig || typeof existingConfig !== "object") {
    return "existing file is not valid JSON";
  }
  const cfg = existingConfig as Record<string, any>;
  const existingEmail: string | undefined =
    typeof cfg.email === "string" && cfg.email.length > 0 ? cfg.email : undefined;
  const existingRegion: string | undefined =
    typeof cfg.mcpServers?.leadbay?.env?.LEADBAY_REGION === "string"
      ? cfg.mcpServers.leadbay.env.LEADBAY_REGION
      : undefined;
  // Compare emails only when both sides supplied one. The OAuth flow has no
  // email (the user proved identity via the browser), so a fresh OAuth login
  // landing on a file with a legacy email shouldn't false-alarm.
  if (existingEmail !== undefined && email !== undefined && existingEmail !== email) {
    return `existing email=${existingEmail} (this login is email=${email})`;
  }
  if (existingRegion !== undefined && existingRegion !== region) {
    return `existing region=${existingRegion} (this login is region=${region})`;
  }
  return null;
}

// Pure platform-routing for the non-legacy default path. Extracted so the
// legacy-fallback message can name the path 0.3.0 would have used WITHOUT
// re-reading the filesystem and without duplicating resolveDefaultCredentialsPath.
export function computeFreshDefaultPath(): string {
  const os = require_("node:os");
  const path = require_("node:path");
  const home = os.homedir();
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg && xdg.length > 0) {
    return path.join(xdg, "leadbay", "credentials.json");
  }
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "leadbay", "credentials.json");
  }
  if (process.platform === "win32") {
    const appdata = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
    return path.join(appdata, "leadbay", "credentials.json");
  }
  return path.join(home, ".config", "leadbay", "credentials.json");
}

async function runLogin(args: string[]): Promise<number> {
  const useOAuth = hasFlag(args, "oauth");
  const useStaging = hasFlag(args, "staging");
  const email = parseFlag(args, "email");
  const defaultPathPreview = (() => {
    try { return resolveDefaultCredentialsPath().path; } catch { return "<HOME>/.config/leadbay/credentials.json"; }
  })();
  // OAuth flow doesn't need --email; the user proves identity via the browser.
  if (!email && !useOAuth) {
    process.stderr.write(
      "Usage: leadbay-mcp login --email you@example.com [--region us|fr] [--allow-region-fallback]\n" +
        "                        [--write-config PATH] [--unsafe-print-token] [--force] [--quiet]\n" +
        "       leadbay-mcp login --oauth [--region us|fr] [--staging] [--write-config PATH] [--force] [--quiet]\n" +
        "  Then enter your password (hidden), or pipe it via stdin / set $LEADBAY_PASSWORD.\n" +
        "  --oauth             Use OAuth Authorization Code + PKCE in your browser instead of email/password.\n" +
        "                      Region is auto-detected via stargate GeoIP; pass --region to override.\n" +
        "  --staging           Point at staging.leadbay.app endpoints. Use with --oauth for testing.\n" +
        "  --region            Pin the backend (us|fr); avoids sending your password to a backend you don't use.\n" +
        "                      Defaults to $LEADBAY_REGION if set; otherwise asks you to pass --allow-region-fallback.\n" +
        "  --allow-region-fallback   Try us, then fr (or fr, then us). Your password hits BOTH backends if the\n" +
        "                            first 401s. Only do this if you're OK with that.\n" +
        `  Default behavior (0.3.0+): writes the MCP-client JSON to the platform-correct credentials path:\n` +
        `                            ${defaultPathPreview} (mode 0600).\n` +
        "  --write-config PATH       Override the default path with PATH (mode 0600).\n" +
        "  --unsafe-print-token      Print the token to stdout (legacy 0.2.x behavior). Use only for CI flows that\n" +
        "                            scrape stdout. The token will end up in scrollback / logs.\n" +
        "  --force                   Overwrite the credentials file even if it already contains a different token/region.\n" +
        "  --quiet                   With --write-config / default file-write, suppress the printed Claude-Code one-liner.\n"
    );
    return 2;
  }

  // Region resolution rules, in priority order:
  //   1. --region <us|fr> on argv → pin, no fallback
  //   2. $LEADBAY_REGION env (us|fr) → pin, no fallback
  //   3. --allow-region-fallback → try us then fr (or fr then us if 1 or 2 picked one)
  //   4. neither pin nor opt-in → refuse and explain (avoids silent cross-region credential leak)
  const regionArg = parseFlag(args, "region");
  const regionEnv = process.env.LEADBAY_REGION;
  const allowFallback = hasFlag(args, "allow-region-fallback");
  let pinnedRegion: "us" | "fr" | null = null;
  if (regionArg === "us" || regionArg === "fr") pinnedRegion = regionArg;
  else if (!regionArg && (regionEnv === "us" || regionEnv === "fr")) pinnedRegion = regionEnv;
  else if (regionArg) {
    process.stderr.write(`leadbay-mcp login: invalid --region '${regionArg}' (use us or fr)\n`);
    return 2;
  }

  if (!pinnedRegion && !allowFallback && !useOAuth) {
    process.stderr.write(
      "leadbay-mcp login: refusing to auto-detect region without consent.\n" +
        "  Avoiding silent credential cross-leak: by default, --region (or $LEADBAY_REGION) must be set\n" +
        "  so your password only ever hits the backend that owns your account.\n" +
        "  Either:\n" +
        "    --region us    (or --region fr)\n" +
        "  or, if you don't know your region and accept the trade-off:\n" +
        "    --allow-region-fallback   (your password will hit BOTH backends if the first 401s)\n"
    );
    return 2;
  }

  let result: { region: "us" | "fr"; baseUrl: string; token: string; verified: boolean };

  if (useOAuth) {
    // Region: explicit --region wins. Otherwise probe stargate by GeoIP — no
    // email needed (the consent flow happens in the user's already-logged-in
    // browser, which is bound to its own regional session anyway).
    let region: "us" | "fr";
    if (pinnedRegion) {
      region = pinnedRegion;
    } else {
      try {
        process.stderr.write("Detecting your region from stargate…\n");
        region = await inferRegionViaStargate({ staging: useStaging });
        process.stderr.write(`Detected region: ${region.toUpperCase()}\n`);
      } catch (err: any) {
        process.stderr.write(`leadbay-mcp@${VERSION} login --oauth: ${err?.message ?? String(err)}\n`);
        await reportCliFailure("__oauth_login__", err);
        return 1;
      }
    }
    const baseUrl = OAUTH_BASE_URLS[useStaging ? "staging" : "prod"][region];
    try {
      const { hostname } = await import("node:os");
      const clientName = `Leadbay MCP @ ${hostname()}`;
      const { accessToken } = await oauthLogin({
        authServerBaseUrl: baseUrl,
        clientName,
        log: (m) => process.stderr.write(m),
      });
      result = { region, baseUrl, token: accessToken, verified: true };
    } catch (err: any) {
      process.stderr.write(`leadbay-mcp@${VERSION} login --oauth: ${err?.message ?? String(err)}\n`);
      await reportCliFailure("__oauth_login__", err);
      return 1;
    }
  } else {
    const password = await readPassword();
    if (!password) {
      process.stderr.write("leadbay-mcp login: empty password\n");
      return 2;
    }

    try {
      if (pinnedRegion && !allowFallback) {
        // Pinned: directly use that region; no fallback even on 401.
        const { REGIONS } = await import("@leadbay/core");
        const baseUrl = REGIONS[pinnedRegion];
        const c = createClient({ region: pinnedRegion });
        // Use the existing client transport for a single login attempt.
        const token = await loginAt(baseUrl, email!, password);
        result = { region: pinnedRegion, baseUrl, token, verified: true };
        void c;
      } else {
        // Either pinned with explicit fallback consent, or no pin + consent.
        result = await resolveRegion(email!, password, pinnedRegion ?? undefined);
      }
    } catch (err: any) {
      process.stderr.write(`leadbay-mcp@${VERSION} login: ${err?.message ?? String(err)}\n`);
      await reportCliFailure("__login__", err);
      return 1;
    }
  }

  // Stamp `email` at the envelope root so future re-logins on the same account
  // can detect "same account, different token" (every loginAt() mints a fresh
  // token; collision detection by token equality always failed). MCP clients
  // ignore unknown top-level fields, so this is safe to add. OAuth flow has
  // no email (the user proved identity via the browser, not in the CLI), so
  // we omit the field — the collision check tolerates that.
  const envBlock: Record<string, string> = {
    LEADBAY_TOKEN: result.token,
    LEADBAY_REGION: result.region,
  };
  // When pointing at staging, persist LEADBAY_BASE_URL so the user's MCP
  // client doesn't silently snap back to prod (where this token is invalid).
  if (useStaging) envBlock.LEADBAY_BASE_URL = result.baseUrl;
  const config = {
    ...(email ? { email } : {}),
    mcpServers: {
      leadbay: {
        command: "npx",
        args: ["-y", "@leadbay/mcp@latest"],
        env: envBlock,
      },
    },
  };

  const writeConfigPath = parseFlag(args, "write-config");
  const quiet = hasFlag(args, "quiet");
  const force = hasFlag(args, "force");
  const unsafePrint = hasFlag(args, "unsafe-print-token");
  const printTokenLegacy = hasFlag(args, "print-token");
  if (printTokenLegacy && !unsafePrint) {
    process.stderr.write(
      "[leadbay-mcp warn] --print-token is deprecated since 0.3.0; renaming to --unsafe-print-token. The flag still works for one release.\n"
    );
  }
  const printToStdout = unsafePrint || printTokenLegacy;

  // ── stdout path (legacy 0.2.x behavior, opt-in only since 0.3.0) ──
  if (printToStdout) {
    process.stderr.write(
      `\nLogged in to ${result.region.toUpperCase()} backend ` +
        `(${result.verified ? "verified" : "UNVERIFIED — check your email"}).\n\n` +
        `⚠️  About to print your bearer token to STDOUT.\n` +
        `   Treat it like a password. Do NOT paste this into chat, screen-share, or commit it.\n` +
        `   For safer handling, re-run without --unsafe-print-token (default writes a 0600 file).\n\n` +
        `Add this to your MCP client config:\n\n`
    );
    process.stdout.write(JSON.stringify(config, null, 2) + "\n");
    process.stderr.write(
      `\nOr for Claude Code (token included — same warning applies):\n\n` +
        `  claude mcp add leadbay --scope user \\\n` +
        `    --env LEADBAY_TOKEN=${result.token} \\\n` +
        `    --env LEADBAY_REGION=${result.region} \\\n` +
        `    -- npx -y @leadbay/mcp@latest\n\n` +
        `Restart your MCP client to pick up the new server.\n`
    );
    return 0;
  }

  // ── file-write path: explicit --write-config OR default platform path ──
  let targetPath: string;
  let usingLegacyPath = false;
  if (writeConfigPath) {
    targetPath = writeConfigPath;
  } else {
    const resolved = resolveDefaultCredentialsPath();
    targetPath = resolved.path;
    usingLegacyPath = resolved.legacy;
  }

  // Collision detection (see checkLoginCollision for the decision rule).
  try {
    const { existsSync, readFileSync } = await import("node:fs");
    if (existsSync(targetPath) && !force) {
      let existing: unknown;
      try {
        existing = JSON.parse(readFileSync(targetPath, "utf8"));
      } catch {
        process.stderr.write(
          `leadbay-mcp login: ${targetPath} exists but is not valid JSON. Pass --force to overwrite.\n`
        );
        return 1;
      }
      const collision = checkLoginCollision(existing, email, result.region);
      if (collision) {
        process.stderr.write(
          `leadbay-mcp login: refusing to overwrite ${targetPath} — ${collision}.\n` +
            `  Pass --force to overwrite, or --write-config /some/other/path.json to keep both.\n`
        );
        return 1;
      }
    }
  } catch (err: any) {
    process.stderr.write(`leadbay-mcp login: ${err?.message ?? String(err)}\n`);
    return 1;
  }

  // Atomic write: tmp + chmod + rename. SIGINT mid-write leaves the tmp file
  // (cleaned up best-effort), never a half-written credentials file. Setting
  // mode on the tmp file BEFORE rename eliminates the writeFileSync→chmod
  // TOCTOU window where the token could briefly sit at the umask default.
  let actualMode: number | undefined;
  try {
    const { writeFileSync, chmodSync, mkdirSync, renameSync, statSync, unlinkSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    mkdirSync(dirname(targetPath), { recursive: true });
    const tmp = targetPath + ".tmp." + process.pid;
    writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600,
    });
    try {
      chmodSync(tmp, 0o600);
    } catch {
      // Filesystem may not support POSIX modes (FAT32/exFAT/some NFS). Continue
      // — we'll surface the actual mode to the user below.
    }
    renameSync(tmp, targetPath);
    try {
      actualMode = statSync(targetPath).mode & 0o777;
    } catch { /* mode reporting is best-effort */ }
    // Defensive cleanup if rename somehow left the tmp behind (shouldn't happen
    // on POSIX renameSync, but Windows can be quirky on cross-FS paths).
    try { unlinkSync(tmp); } catch { /* expected to fail post-rename */ }
  } catch (err: any) {
    const code = err?.code;
    if (code === "EACCES" || code === "EROFS" || code === "ENOENT") {
      process.stderr.write(
        `leadbay-mcp login: cannot write ${targetPath} (${code}).\n` +
          `  Use --write-config /tmp/leadbay-mcp.json (or another writable path),\n` +
          `  or --unsafe-print-token (last resort — token in stdout).\n`
      );
      return 1;
    }
    process.stderr.write(`leadbay-mcp login: ${err?.message ?? String(err)}\n`);
    return 1;
  }

  // Don't claim "(mode 0600)" when stat says otherwise — tell the truth so the
  // user can act on a permissions surprise.
  const modeNote = actualMode === 0o600
    ? "(mode 0600)"
    : actualMode !== undefined
    ? `(mode 0${actualMode.toString(8)} — chmod 0600 failed; treat the file as sensitive)`
    : "(mode unknown)";
  process.stderr.write(
    `\nLogged in to ${result.region.toUpperCase()} backend ` +
      `(${result.verified ? "verified" : "UNVERIFIED — check your email"}).\n` +
      `Wrote MCP config to ${targetPath} ${modeNote}. Token NOT printed to terminal.\n`
  );
  if (usingLegacyPath) {
    // Where would 0.3.0 have written this on a fresh install? Re-run the
    // resolver against a synthetic non-legacy state so the message stays in
    // sync with resolveDefaultCredentialsPath without duplicating its logic.
    const newPath = computeFreshDefaultPath();
    process.stderr.write(
      `\n[leadbay-mcp note] Used the legacy 0.2.x path ${targetPath}. The 0.3.0 default is ${newPath}.\n` +
        `  Move the file there at your convenience (no code change required — both paths are read).\n`
    );
  }
  if (!quiet) {
    // Default macOS path contains a space ("Application Support/"). Single-quote
    // the path so the printed `claude mcp add …` is copy-paste safe regardless
    // of where the credentials file landed.
    const quotedPath = `'${targetPath.replace(/'/g, `'\\''`)}'`;
    process.stderr.write(
      `\nFor Claude Code, run:\n` +
        `  claude mcp add leadbay --scope user \\\n` +
        `    --env LEADBAY_TOKEN=$(jq -r .mcpServers.leadbay.env.LEADBAY_TOKEN ${quotedPath}) \\\n` +
        `    --env LEADBAY_REGION=${result.region} \\\n` +
        `    -- npx -y @leadbay/mcp@latest\n`
    );
  }
  process.stderr.write(
    `\nTREAT THE TOKEN AS A SECRET. It grants full access to your Leadbay account.\n` +
      `Delete the config file once your MCP client has it loaded, or keep it 0600.\n`
  );
  return 0;
}

// Single-region login (used when the user pinned --region and we must NOT
// fall back to the other backend). Imports https inline to keep startup cheap.
export async function loginAt(baseUrl: string, email: string, password: string): Promise<string> {
  const https = await import("node:https");
  return await new Promise<string>((resolve, reject) => {
    const body = JSON.stringify({ email, password });
    const u = new URL(baseUrl + "/1.5/auth/login");
    const r = https.request(
      {
        hostname: u.hostname,
        port: 443,
        path: u.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          if (res.statusCode === 200) {
            try {
              const parsed = JSON.parse(raw);
              if (parsed?.token) return resolve(parsed.token);
              return reject(new Error("login response had no token"));
            } catch {
              return reject(new Error("login response was not JSON"));
            }
          }
          reject(
            new Error(formatLoginError(res.statusCode ?? 0, raw, baseUrl))
          );
        });
      }
    );
    r.on("error", reject);
    r.write(body);
    r.end();
  });
}

export async function runUninstall(_args: string[]): Promise<number> {
  return runInstallerGuiCommand(["--uninstall"]);
}

async function runInstallerGuiCommand(args: string[]): Promise<number> {
  const { spawn } = await import("node:child_process");
  const guiPath = fileURLToPath(new URL("./installer-electron.js", import.meta.url));
  return await new Promise((resolve) => {
    const child = spawn(process.execPath, [guiPath, ...args], { stdio: "inherit", env: process.env });
    child.on("error", (err) => {
      process.stderr.write(`leadbay-mcp installer: ${err.message}\n`);
      resolve(1);
    });
    child.on("exit", (code, signal) => {
      if (signal) resolve(128 + (signal === "SIGINT" ? 2 : signal === "SIGTERM" ? 15 : 0));
      else resolve(code ?? 0);
    });
  });
}

export async function runInstall(args: string[]): Promise<number> {
  const useOAuth = hasFlag(args, "oauth");
  const useStaging = hasFlag(args, "staging");
  const email = parseFlag(args, "email");
  if (!email && !useOAuth) {
    process.stderr.write(
      "Usage: leadbay-mcp install --oauth [--region us|fr]\n" +
        "       leadbay-mcp install --email you@example.com [--region us|fr]\n" +
        "                          [--allow-region-fallback] [--no-write] [--no-telemetry]\n" +
        "                          [--target claude-code,claude-desktop,cursor,codex]\n" +
        "                          [--yes] [--force-legacy]\n" +
        "  Authenticates with Leadbay and registers the MCP server with your installed clients (at user scope).\n" +
        "  --oauth             Use browser OAuth instead of email/password.\n" +
        "  --staging           Point OAuth at staging Leadbay endpoints.\n" +
        "  --target            Comma-separated subset; default = all detected.\n" +
        "  --no-write          Disable composite write tools (refine_prompt, report_outreach,\n" +
        "                      adjust_audience, etc.). They are ON by default since 0.3.0;\n" +
        "                      pass --no-write for read-only agents.\n" +
        "  --no-telemetry      Opt out of product usage events (PostHog + Sentry).\n" +
        "                      Defaults to ON: helps Leadbay improve the MCP. Events are\n" +
        "                      tied to your Leadbay email; tool args, response bodies,\n" +
        "                      and lead PII are NEVER captured.\n" +
        "  --include-write     (deprecated since 0.3.0; now a no-op — writes are on by default).\n" +
        "  --yes               Don't ask before installing into each detected client.\n" +
        "  --force-legacy      Deprecated compatibility flag; install updates detected clients by default.\n"
    );
    return 2;
  }

  // Deprecate --include-write IMMEDIATELY (before password prompt) so the
  // user actually sees the warning. In 0.2.x this flag enabled writes; in
  // 0.3.0 writes are on by default and the flag is a no-op.
  if (hasFlag(args, "include-write")) {
    process.stderr.write(
      "[leadbay-mcp warn] --include-write is the default since 0.3.0; the flag is now a no-op.\n" +
        "  Composite write tools (refine_prompt, report_outreach, adjust_audience, etc.) are ON by default.\n" +
        "  Pass --no-write to install in read-only mode.\n\n"
    );
  }

  // Region pin (same rule as login — refuse to auto-detect without consent).
  const regionArg = parseFlag(args, "region");
  const regionEnv = process.env.LEADBAY_REGION;
  const allowFallback = hasFlag(args, "allow-region-fallback");
  let pinnedRegion: "us" | "fr" | null = null;
  if (regionArg === "us" || regionArg === "fr") pinnedRegion = regionArg;
  else if (!regionArg && (regionEnv === "us" || regionEnv === "fr")) pinnedRegion = regionEnv;
  else if (regionArg) {
    process.stderr.write(`leadbay-mcp install: invalid --region '${regionArg}' (use us or fr)\n`);
    return 2;
  }
  if (!pinnedRegion && !allowFallback && !useOAuth) {
    process.stderr.write(
      "leadbay-mcp install: --region us|fr (or $LEADBAY_REGION) is required by default.\n" +
        "  This avoids sending your password to a Leadbay backend you don't use.\n" +
        "  Pass --allow-region-fallback to opt in to auto-detect (your password will hit BOTH backends if the first 401s).\n"
    );
    return 2;
  }

  // Detect clients early so automation flags can fail fast. Interactive users
  // choose clients after login, when the wizard can show the connected region.
  const detected = await detectClients();
  const targetArg = parseFlag(args, "target");
  const skipPrompts = hasFlag(args, "yes");
  const useWizard = !targetArg && !skipPrompts && isInteractiveInstall();
  let chosen: DetectedClient[] | null = null;
  if (targetArg) {
    const want = new Set(targetArg.split(",").map((str) => str.trim()).filter(Boolean));
    chosen = detected.filter((client) => want.has(client.id));
    const missing = [...want].filter((id) => !detected.some((client) => client.id === id));
    if (missing.length) {
      process.stderr.write(
        `leadbay-mcp install: --target requested [${[...want].join(", ")}] but these were not detected on this machine: ${missing.join(", ")}\n`
      );
      // Don't bail — proceed with what we have.
    }
  } else if (!useWizard) {
    chosen = detected;
  }
  if (detected.length === 0 || (chosen !== null && chosen.length === 0)) {
    process.stderr.write(
      "leadbay-mcp install: no MCP clients detected on this machine.\n" +
        "  Install Claude Code (https://docs.claude.com/claude-code), Claude Desktop, ChatGPT Desktop, Cursor, or Codex first,\n" +
        "  or use `leadbay-mcp login --oauth --write-config /path/to/config.json` to authenticate without auto-install.\n"
    );
    return 1;
  }

  let token: string;
  let region: "us" | "fr";
  try {
    if (useOAuth) {
      if (pinnedRegion) {
        region = pinnedRegion;
      } else {
        process.stderr.write("Detecting your region from stargate…\n");
        region = await inferRegionViaStargate({ staging: useStaging });
        process.stderr.write(`Detected region: ${region.toUpperCase()}\n`);
      }
      const baseUrl = OAUTH_BASE_URLS[useStaging ? "staging" : "prod"][region];
      const { hostname } = await import("node:os");
      const { accessToken } = await oauthLogin({
        authServerBaseUrl: baseUrl,
        clientName: `Leadbay MCP installer @ ${hostname()}`,
        log: (m) => process.stderr.write(m),
      });
      token = accessToken;
    } else {
      // Prompt for password after validation so users do not type it before a
      // fast-failing target or region error.
      const password = await readPassword();
      if (!password) {
        process.stderr.write("leadbay-mcp install: empty password\n");
        return 2;
      }
      if (pinnedRegion && !allowFallback) {
        const { REGIONS } = await import("@leadbay/core");
        const baseUrl = REGIONS[pinnedRegion];
        token = await loginAt(baseUrl, email!, password);
        region = pinnedRegion;
      } else {
        const result = await resolveRegion(email!, password, pinnedRegion ?? undefined);
        token = result.token;
        region = result.region;
      }
    }
  } catch (err: any) {
    process.stderr.write(`leadbay-mcp@${VERSION} install: ${err?.message ?? String(err)}\n`);
    await reportCliFailure("__install_login__", err);
    return 1;
  }
  process.stderr.write(`Logged in to ${region.toUpperCase()} backend.\n\n`);

  // Writes are ON by default since 0.3.0; --no-write opts out. Telemetry is
  // ON by default; --no-telemetry opts out.
  const includeWrite = !hasFlag(args, "no-write");
  const telemetryEnabled = !hasFlag(args, "no-telemetry");
  process.stderr.write(
    `Settings: write tools ${includeWrite ? "on" : "off"}, telemetry ${telemetryEnabled ? "on" : "off"}.\n`
  );

  if (useWizard) {
    chosen = await chooseInstallClients(detected);
  }
  chosen = chosen ?? detected;
  if (chosen.length === 0) {
    process.stderr.write("\nNo agents selected; nothing installed.\n");
    return 0;
  }

  process.stderr.write(`\nInstalling Leadbay MCP into:\n`);
  for (const c of chosen) {
    process.stderr.write(`  - ${c.label.padEnd(16)} ${c.detail}\n`);
  }
  process.stderr.write("\n");

  const results: Array<{ id: string; label: string; ok: boolean; message: string }> = [];
  for (const c of chosen) {
    const ok = skipPrompts || useWizard || (await readChoice(`Install into ${c.label} (${c.detail})?`, true));
    if (!ok) {
      results.push({ id: c.id, label: c.label, ok: false, message: "skipped by user" });
      continue;
    }
    let res: { ok: boolean; message: string };
    if (c.id === "claude-code") {
      res = await installInClaudeCode(token, region, includeWrite, telemetryEnabled);
    } else if (c.id === "codex") {
      const configRes = await installInCodexConfig(c.configPath ?? c.detail, includeWrite, telemetryEnabled);
      if (!configRes.ok) {
        res = configRes;
      } else {
        const exportRes = await appendShellExports(token, region, includeWrite, telemetryEnabled);
        res = exportRes.ok
          ? { ok: true, message: `${configRes.message}; ${exportRes.message}` }
          : { ok: false, message: `config ${configRes.message}; ${exportRes.message}` };
      }
    } else if (c.id === "chatgpt-desktop") {
      res = {
        ok: true,
        message: "manual setup required; add this MCP URL in ChatGPT Settings > Apps: " + HOSTED_MCP_URL,
      };
    } else if (c.id === "claude-desktop" && c.mode?.dxt && c.supportDir) {
      const dxtResult = await removeDxtExtension(c.supportDir);
      const jsonResult = await installInJsonConfig(c.configPath!, token, region, includeWrite, telemetryEnabled);
      res = jsonResult.ok
        ? { ok: true, message: dxtResult.removed ? `DXT extension removed; ${jsonResult.message}` : jsonResult.message }
        : jsonResult;
    } else {
      // claude-desktop and cursor both use the same JSON shape.
      res = await installInJsonConfig(c.configPath!, token, region, includeWrite, telemetryEnabled);
    }
    results.push({ id: c.id, label: c.label, ...res });
  }

  const summaryColor = process.stderr.isTTY === true && process.env.NO_COLOR !== "1";
  process.stderr.write(`\n${ansi(`=== install summary (leadbay-mcp@${VERSION}) ===`, "1;36", summaryColor)}\n`);
  let anyOk = false;
  for (const r of results) {
    const skipped = r.message.startsWith("skipped");
    const color = r.ok ? "32" : skipped ? "33" : "31";
    const symbol = r.ok
      ? ansi("✓", color, summaryColor)
      : skipped
      ? ansi("-", color, summaryColor)
      : ansi("✗", color, summaryColor);
    const label = ansi(r.label.padEnd(16), color, summaryColor);
    const message = ansi(r.message, color, summaryColor);
    process.stderr.write(`  ${symbol} ${label} ${message}\n`);
    if (r.ok) {
      anyOk = true;
    } else if (!skipped) {
      await reportCliFailure(
        `install:${r.id}`,
        new Error(`${r.label}: ${r.message}`)
      );
    }
  }
  process.stderr.write(
    `\nThe Leadbay credential was written into client config files but never printed to your terminal.\n` +
      `Verify with: LEADBAY_TOKEN=$(...) npx -y @leadbay/mcp@latest doctor\n` +
      `Restart your MCP client(s) to pick up the new server.\n` +
      `If you ever leak the credential, run \`leadbay-mcp login --oauth\` to create a fresh one.\n`
  );
  return anyOk ? 0 : 1;
}

async function runDoctor(): Promise<number> {
  const token = process.env.LEADBAY_TOKEN;
  if (!token) {
    exitWithTokenError();
  }

  const logger = makeStderrLogger(parseLogLevel(process.env.LEADBAY_LOG_LEVEL));
  const regionEnv = process.env.LEADBAY_REGION;
  const baseUrl = process.env.LEADBAY_BASE_URL;

  const regions: Array<"us" | "fr"> = regionEnv === "fr"
    ? ["fr", "us"]
    : regionEnv === "us"
    ? ["us", "fr"]
    : ["us", "fr"];

  for (const region of regions) {
    const config: CreateClientConfig = { token };
    if (baseUrl) config.baseUrl = baseUrl;
    else config.region = region;
    const client = createClient(config);
    logger.info?.(`Trying region="${region}" baseUrl="${client.baseUrl}"`);
    try {
      const me = await client.request<{
        id: string;
        organization: {
          id: string;
          name: string;
          billing?: {
            status: string;
            ai_credits: number | null;
            ai_credits_quota: number | null;
          } | null;
        };
      }>("GET", "/users/me");
      process.stdout.write(
        `Leadbay connection OK.\n` +
          `  Version:       leadbay-mcp@${VERSION} (node ${process.versions.node}, ${process.platform})\n` +
          `  Region:        ${baseUrl ? "(custom baseUrl)" : region}\n` +
          `  Base URL:      ${client.baseUrl}\n` +
          `  Organization:  ${me.organization.name} (${me.organization.id})\n` +
          `  Billing:       ${me.organization.billing?.status ?? "unknown"}\n` +
          `  AI credits:    ${
            me.organization.billing?.ai_credits ?? "?"
          } / ${me.organization.billing?.ai_credits_quota ?? "?"}\n`
      );
      return 0;
    } catch (err: any) {
      logger.error?.(`${region}: ${err?.message ?? err}`);
      if (err?.code === "AUTH_EXPIRED" || err?.code === "NOT_AUTHENTICATED") {
        process.stderr.write(
          `Leadbay: your LEADBAY_TOKEN is not valid for ${region}. ${err.hint}\n` +
            `  (leadbay-mcp@${VERSION})\n`
        );
        await reportCliFailure("__doctor_auth__", err);
        return 1;
      }
      // fall through and try next region
    }
    if (baseUrl) break; // custom baseUrl — don't try other regions
  }
  process.stderr.write(
    `Leadbay doctor: could not reach any Leadbay region with this token. Check the token and your network.\n` +
      `  (leadbay-mcp@${VERSION})\n`
  );
  await reportCliFailure(
    "__doctor_unreachable__",
    new Error("doctor: no region reachable with current token")
  );
  return 1;
}

// Report a CLI-subcommand failure (install / login / doctor) to Sentry
// before the caller `return`s its exit code. Without this, every error
// inside runInstall/runLogin/runDoctor exits with stderr-only output —
// users see the message in their terminal but Leadbay never learns
// reinstall is broken on their machine. Init is single-shot per call;
// shutdown is bounded inside telemetry.shutdown() so a network hang
// can't stall CLI exit.
async function reportCliFailure(label: string, err: unknown): Promise<void> {
  try {
    const bootTelemetry = initTelemetry({ version: VERSION });
    bootTelemetry.captureException(err, { tool: label });
    await bootTelemetry.shutdown();
  } catch {
    // Never let telemetry mask the underlying CLI failure.
  }
}

// Install last-resort handlers so any uncaught exception or unhandled
// rejection during startup (or after server.connect) leaves a visible
// stack trace on stderr + a Sentry event before the process exits.
// Without these, Node's default kills the process after a deprecation
// warning that some hosts don't surface — leaving the user staring at
// "Server disconnected" with no clue why. Called from main(); also
// exported for tests (via the symbol exists; not currently asserted).
let startupSafetyNetsInstalled = false;
function installStartupSafetyNets(logger: ToolLogger): void {
  if (startupSafetyNetsInstalled) return;
  startupSafetyNetsInstalled = true;

  const reportAndExit = (label: string, err: unknown): void => {
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    process.stderr.write(`leadbay-mcp@${VERSION}: ${label}: ${msg}\n`);
    logger.error?.(`${label}: ${msg}`);
    // Fire-and-forget Sentry capture. Bounded by the same pattern as
    // the bootstrap catch at the entrypoint — telemetry must never
    // block the failure exit.
    try {
      const bootTelemetry = initTelemetry({ version: VERSION });
      bootTelemetry.captureException(err, { tool: "__startup__" });
      // Don't await shutdown — process.exit(1) below flushes stdio;
      // Sentry's internal flush will best-effort post in the small
      // window before the process actually dies.
      void bootTelemetry.shutdown();
    } catch {
      // Swallow — never let telemetry mask the underlying failure.
    }
    process.exit(1);
  };

  process.on("uncaughtException", (err) => reportAndExit("uncaughtException", err));
  process.on("unhandledRejection", (err) => reportAndExit("unhandledRejection", err));
}

async function main(): Promise<void> {
  const arg = process.argv[2];

  if (arg === "--version" || arg === "-v") {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (arg === "--help" || arg === "-h" || arg === "help") {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  if (arg === "installer" || arg === "gui") {
    process.exit(await runInstallerGuiCommand(process.argv.slice(3)));
  }
  if (arg === "install") {
    process.exit(await runInstall(process.argv.slice(3)));
  }
  if (arg === "uninstall") {
    process.exit(await runUninstall(process.argv.slice(3)));
  }
  if (arg === "login") {
    process.exit(await runLogin(process.argv.slice(3)));
  }
  if (arg === "doctor") {
    process.exit(await runDoctor());
  }

  // Stdio MCP mode (default).
  const logger = makeStderrLogger(parseLogLevel(process.env.LEADBAY_LOG_LEVEL));

  // Safety nets installed before any startup I/O so a silent crash during
  // the JSON-RPC `initialize` handshake (which would otherwise show up on
  // the host as a bare "Server disconnected" with no diagnostic) leaves a
  // real stack on stderr + Sentry. Stdio writes are flushed synchronously
  // before exit because we use the sync `process.exit` path; without these
  // handlers, Node's default for unhandledRejection (since v15) is to log
  // a deprecation warning then terminate with code 1 and no stack.
  installStartupSafetyNets(logger);

  // Telemetry (PostHog + Sentry). ON by default; opt-out via
  // LEADBAY_TELEMETRY_DISABLED=1. See packages/mcp/src/telemetry.ts.
  const telemetry = initTelemetry({ version: VERSION, logger });
  const { client, authState } = await resolveClientFromEnv(logger);
  // Non-blocking identify — kicks off /users/me (cached if region
  // auto-probe already paid for it). Events captured before identity
  // resolves are buffered and flushed once me.email lands. With a broken
  // client (authState != "ok"), resolveMe rejects but telemetry.identify
  // has its own catch and flushes events anonymously.
  telemetry.identify(client);
  // Bucket disconnects by auth-state in PostHog so a regression in the
  // startup-auth path is visible without reading the user's logs.
  telemetry.captureStartup({
    auth_state: authState,
    region: client.region,
  });
  const includeAdvanced = process.env.LEADBAY_MCP_ADVANCED === "1";
  const includeWrite = parseWriteEnv();

  // Bulk tracker: file-backed by default at ~/.leadbay/bulks.json.
  // Fails loudly unless LEADBAY_BULK_STORE_ALLOW_MEMORY=1 is set.
  const bulkTracker = await createDefaultBulkStore({ logger });

  // Auto-update state — best-effort; falls back to in-memory when
  // ~/.leadbay is unwritable. Created BEFORE the version-check kicks
  // off below so checkForUpdate can persist its result.
  const updateStateStore = await createDefaultUpdateStateStore({ logger });
  // Fire-and-forget: detect "this boot is on a newer version than the
  // previous boot" → emit `mcp version updated` PostHog event. Works
  // even when offline. Runs before the GitHub check so the event fires
  // promptly on a fresh upgrade.
  void recordRunningVersion(VERSION, updateStateStore, telemetry).catch((err) => {
    logger.warn?.(
      `update_state.record_version_failed ${err?.message ?? err}`
    );
  });
  // Fire-and-forget GitHub releases check. force=true so a fresh boot
  // always hits GitHub — the 24h throttle is for the per-tool-call
  // recheck in long-running processes (server.ts), not for new sessions
  // that need to learn about releases shipped since the prior process.
  // Hard opt-out: LEADBAY_UPDATE_CHECK_DISABLED=1.
  if (process.env.LEADBAY_UPDATE_CHECK_DISABLED !== "1") {
    void checkForUpdate({
      currentVersion: VERSION,
      stateStore: updateStateStore,
      telemetry,
      logger,
      force: true,
    }).catch((err) => {
      logger.warn?.(`update_check.unexpected ${err?.message ?? err}`);
    });
  }

  const server = buildServer(client, {
    includeAdvanced,
    includeWrite,
    logger,
    bulkTracker,
    version: VERSION,
    telemetry,
    updateStateStore,
  });
  const transport = new StdioServerTransport();
  logger.info?.(
    `Starting MCP server v${VERSION} (advanced=${includeAdvanced}, write=${includeWrite}, baseUrl=${client.baseUrl}, bulk_store=${bulkTracker.durability}, auth_state=${authState})`
  );
  await server.connect(transport);

  // Shutdown hooks: flush PostHog + Sentry bounded at 2s each so a network
  // hang can't block process exit. stdio-end fires when the MCP client
  // (Claude Desktop, Cursor) disconnects — same effect as SIGTERM.
  const shutdown = async (code: number) => {
    try {
      await telemetry.shutdown();
    } finally {
      process.exit(code);
    }
  };
  process.once("SIGINT", () => void shutdown(130));
  process.once("SIGTERM", () => void shutdown(143));
  process.stdin.once("end", () => void shutdown(0));
}

// Run main() only when invoked as a CLI. realpath on both sides handles
// npx shim symlinks (issue #3504: silent exit 0 under Node 25 + npx).
const isEntrypoint = (() => {
  try {
    const entry = process.argv[1];
    if (!entry) return false;
    const entryName = basename(entry).toLowerCase();
    if (entryName !== "bin.js" && entryName !== "leadbay-mcp" && entryName !== "index.js") return false;
    const self = fileURLToPath(import.meta.url);
    return realpathSync(self) === realpathSync(entry);
  } catch {
    return false;
  }
})();

if (isEntrypoint) {
  main().catch(async (err) => {
    process.stderr.write(`leadbay-mcp: ${err?.message ?? err}\n`);
    // Best-effort Sentry capture for bootstrap failures (token missing,
    // region probe fully failed, etc.). Standalone init so the catch site
    // doesn't depend on main() having reached the telemetry handle.
    try {
      const bootTelemetry = initTelemetry({ version: VERSION });
      bootTelemetry.captureException(err, { tool: "__bootstrap__" });
      await bootTelemetry.shutdown();
    } catch {
      // Swallow — telemetry must never block the failure exit.
    }
    process.exit(1);
  });
}
