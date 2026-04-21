import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  createClient,
  createDefaultBulkStore,
  LeadbayClient,
  resolveRegion,
  type CreateClientConfig,
  type ToolLogger,
} from "@leadbay/core";
import { buildServer } from "./server.js";

// __LEADBAY_MCP_VERSION__ is replaced at build time by tsup with the string
// literal from packages/mcp/package.json#version. Single source of truth —
// bump package.json and both the tarball and --version output track it.
declare const __LEADBAY_MCP_VERSION__: string;
const VERSION = __LEADBAY_MCP_VERSION__;

const HELP = `
leadbay-mcp ${VERSION} — Leadbay Model Context Protocol server

USAGE
  leadbay-mcp            Run the MCP stdio server (for Claude Desktop, Cursor, etc.)
  leadbay-mcp install    One-shot setup: mint a token AND register the MCP server with
                         your installed MCP clients (Claude Code / Claude Desktop /
                         Cursor). Auto-detects which clients are installed; you confirm
                         before each write. Token never lands in terminal scrollback.
                         Run this first if you're getting started.
  leadbay-mcp login      Lower-level: just mint a bearer token (no auto-install).
                         Use when you want to copy the token into a config file
                         yourself.
  leadbay-mcp doctor     Validate your token, probe your region, print account + quota.
  leadbay-mcp --version  Print version
  leadbay-mcp --help     Print this help

ENV VARS
  LEADBAY_TOKEN          (required) Bearer token from https://app.leadbay.ai/settings/api-tokens
  LEADBAY_REGION         (optional) "us" or "fr". Auto-detected from /users/me if unset.
  LEADBAY_BASE_URL       (optional) Override API base URL (for staging/dev).
  LEADBAY_MCP_ADVANCED   (optional) Set to "1" to expose granular API tools alongside
                         the composite workflow tools. Most users don't need this.
  LEADBAY_MCP_WRITE      (optional) Set to "1" to expose write composites (refine_prompt,
                         report_outreach, adjust_audience, etc.) and write granulars.
                         Defaults off — read composites are exposed by default; mutations
                         require explicit opt-in.
  LEADBAY_MOCK           (optional) Set to "1" to serve all responses from on-disk fixtures
                         (no network, no real auth). Useful for agent-author dry-running.
                         GETs are matched against fixture JSON files; POSTs/DELETEs are
                         journaled in-process and return {mocked: true, would_call: {...}}.
  LEADBAY_MOCK_DIR       (optional) Fixture directory. Default: ./.context/leadbay-live-shapes/
  LEADBAY_LOG_LEVEL      (optional) "debug" | "info" | "error" (default "error"). Logs to stderr.

EXAMPLE Claude Desktop config (~/Library/Application Support/Claude/claude_desktop_config.json)
  {
    "mcpServers": {
      "leadbay": {
        "command": "npx",
        "args": ["-y", "@leadbay/mcp@0.1"],
        "env": {
          "LEADBAY_TOKEN": "lb_...",
          "LEADBAY_REGION": "us"
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

function exitWithTokenError(): never {
  process.stderr.write(
    "leadbay-mcp: LEADBAY_TOKEN environment variable is required.\n" +
      "  1. Create a token at https://app.leadbay.ai/settings/api-tokens\n" +
      "  2. Set it in your MCP client config (e.g. claude_desktop_config.json).\n" +
      "\n" +
      "Run `leadbay-mcp --help` for the full config template.\n"
  );
  process.exit(1);
}

export async function resolveClientFromEnv(logger: ToolLogger): Promise<LeadbayClient> {
  const token = process.env.LEADBAY_TOKEN;
  if (!token) exitWithTokenError();

  const regionEnv = process.env.LEADBAY_REGION;
  const explicitRegion: "us" | "fr" | undefined =
    regionEnv === "us" || regionEnv === "fr" ? regionEnv : undefined;
  const baseUrl = process.env.LEADBAY_BASE_URL;

  // If the user pinned a baseUrl or region, honor it exactly.
  if (baseUrl || explicitRegion) {
    const config: CreateClientConfig = { token };
    if (baseUrl) config.baseUrl = baseUrl;
    if (explicitRegion) config.region = explicitRegion;
    return createClient(config);
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
    return await Promise.any([probe("us"), probe("fr")]);
  } catch (err: any) {
    // Both failed. The AggregateError exposes each leaf error.
    const errors: any[] = err?.errors ?? [];
    const firstAuth = errors.find(
      (e) => e?.code === "AUTH_EXPIRED" || e?.code === "NOT_AUTHENTICATED"
    );
    if (firstAuth) {
      process.stderr.write(
        `leadbay-mcp: ${firstAuth.message}. ${firstAuth.hint}\n` +
          "Tip: verify your LEADBAY_TOKEN is valid and, if you know your region, set LEADBAY_REGION=us or LEADBAY_REGION=fr.\n"
      );
      process.exit(1);
    }
    // Non-auth failures (network, DNS, etc.) — fall back to us so the
    // server can still start and surface the error on first tool call.
    const firstMsg = errors[0]?.message ?? String(err);
    process.stderr.write(
      `leadbay-mcp: region auto-detection failed (${firstMsg}). Defaulting to us; set LEADBAY_REGION to skip probing.\n`
    );
    return createClient({ token, region: "us" });
  }
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

async function runLogin(args: string[]): Promise<number> {
  const email = parseFlag(args, "email");
  if (!email) {
    process.stderr.write(
      "Usage: leadbay-mcp login --email you@example.com [--region us|fr] [--allow-region-fallback] [--write-config PATH] [--quiet]\n" +
        "  Then enter your password (hidden), or pipe it via stdin / set $LEADBAY_PASSWORD.\n" +
        "  --region            Pin the backend (us|fr); avoids sending your password to a backend you don't use.\n" +
        "                      Defaults to $LEADBAY_REGION if set; otherwise asks you to pass --allow-region-fallback.\n" +
        "  --allow-region-fallback   Try us, then fr (or fr, then us). Your password hits BOTH backends if the\n" +
        "                            first 401s. Only do this if you're OK with that.\n" +
        "  --write-config PATH       Write the resulting MCP-client JSON to PATH with 0600 permissions instead\n" +
        "                            of stdout. Recommended — keeps the token out of terminal scrollback / CI logs.\n" +
        "  --quiet             With --write-config, suppress the printed Claude-Code one-liner that includes the token.\n"
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

  if (!pinnedRegion && !allowFallback) {
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

  const password = await readPassword();
  if (!password) {
    process.stderr.write("leadbay-mcp login: empty password\n");
    return 2;
  }

  let result;
  try {
    if (pinnedRegion && !allowFallback) {
      // Pinned: directly use that region; no fallback even on 401.
      const { REGIONS } = await import("@leadbay/core");
      const baseUrl = REGIONS[pinnedRegion];
      const c = createClient({ region: pinnedRegion });
      // Use the existing client transport for a single login attempt.
      const token = await loginAt(baseUrl, email, password);
      result = { region: pinnedRegion, baseUrl, token, verified: true };
      void c;
    } else {
      // Either pinned with explicit fallback consent, or no pin + consent.
      result = await resolveRegion(email, password, pinnedRegion ?? undefined);
    }
  } catch (err: any) {
    process.stderr.write(`leadbay-mcp login: ${err?.message ?? String(err)}\n`);
    return 1;
  }

  const config = {
    mcpServers: {
      leadbay: {
        command: "npx",
        args: ["-y", "@leadbay/mcp@0.2"],
        env: {
          LEADBAY_TOKEN: result.token,
          LEADBAY_REGION: result.region,
        },
      },
    },
  };

  const writeConfigPath = parseFlag(args, "write-config");
  const quiet = hasFlag(args, "quiet");

  if (writeConfigPath) {
    const { writeFileSync, chmodSync } = await import("node:fs");
    writeFileSync(writeConfigPath, JSON.stringify(config, null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600,
    });
    try { chmodSync(writeConfigPath, 0o600); } catch { /* best-effort */ }
    process.stderr.write(
      `\nLogged in to ${result.region.toUpperCase()} backend ` +
        `(${result.verified ? "verified" : "UNVERIFIED — check your email"}).\n` +
        `Wrote MCP config to ${writeConfigPath} (mode 0600). Token NOT printed to terminal.\n`
    );
    if (!quiet) {
      process.stderr.write(
        `\nFor Claude Code, run:\n` +
          `  claude mcp add leadbay --env LEADBAY_TOKEN=$(jq -r .mcpServers.leadbay.env.LEADBAY_TOKEN ${writeConfigPath}) ` +
          `--env LEADBAY_REGION=${result.region} -- npx -y @leadbay/mcp@0.2\n`
      );
    }
    process.stderr.write(
      `\nTREAT THE TOKEN AS A SECRET. It grants full access to your Leadbay account.\n` +
        `Delete the config file once your MCP client has it loaded, or keep it 0600.\n`
    );
    return 0;
  }

  // Default: print to stdout (with a loud warning).
  process.stderr.write(
    `\nLogged in to ${result.region.toUpperCase()} backend ` +
      `(${result.verified ? "verified" : "UNVERIFIED — check your email"}).\n\n` +
      `⚠️  About to print your bearer token to STDOUT.\n` +
      `   Treat it like a password. Do NOT paste this into chat, screen-share, or commit it.\n` +
      `   For safer handling, re-run with --write-config /path/to/config.json (writes 0600).\n\n` +
      `Add this to your MCP client config:\n\n`
  );
  process.stdout.write(JSON.stringify(config, null, 2) + "\n");
  process.stderr.write(
    `\nOr for Claude Code (token included — same warning applies):\n\n` +
      `  claude mcp add leadbay \\\n` +
      `    --env LEADBAY_TOKEN=${result.token} \\\n` +
      `    --env LEADBAY_REGION=${result.region} \\\n` +
      `    -- npx -y @leadbay/mcp@0.2\n\n` +
      `Restart your MCP client to pick up the new server.\n`
  );
  return 0;
}

// Single-region login (used when the user pinned --region and we must NOT
// fall back to the other backend). Imports https inline to keep startup cheap.
async function loginAt(baseUrl: string, email: string, password: string): Promise<string> {
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
            new Error(
              `login failed (${res.statusCode}) at ${baseUrl}: ${raw.slice(0, 200)}`
            )
          );
        });
      }
    );
    r.on("error", reject);
    r.write(body);
    r.end();
  });
}

// ─── install: one-shot mint + register ────────────────────────────────────

interface DetectedClient {
  id: "claude-code" | "claude-desktop" | "cursor";
  label: string;
  // Where it'll be installed (path or "(claude CLI)" for shell-out targets).
  detail: string;
}

async function detectClients(): Promise<DetectedClient[]> {
  const out: DetectedClient[] = [];
  const { existsSync } = await import("node:fs");
  const os = await import("node:os");

  // Claude Code: `which claude` (or LOCALAPPDATA on Windows).
  const claudeBin = await new Promise<string | null>((resolve) => {
    const cmd = process.platform === "win32" ? "where" : "which";
    const child = require_("node:child_process").spawn(cmd, ["claude"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let buf = "";
    child.stdout.on("data", (c: Buffer) => (buf += c.toString()));
    child.on("close", (code: number) =>
      resolve(code === 0 ? buf.split(/\r?\n/)[0] : null)
    );
  });
  if (claudeBin) {
    out.push({ id: "claude-code", label: "Claude Code", detail: `${claudeBin} mcp add ...` });
  }

  // Claude Desktop config file.
  const home = os.homedir();
  const cdPath =
    process.platform === "win32"
      ? `${process.env.APPDATA ?? `${home}\\AppData\\Roaming`}\\Claude\\claude_desktop_config.json`
      : process.platform === "darwin"
      ? `${home}/Library/Application Support/Claude/claude_desktop_config.json`
      : `${home}/.config/Claude/claude_desktop_config.json`;
  if (existsSync(cdPath)) {
    out.push({ id: "claude-desktop", label: "Claude Desktop", detail: cdPath });
  }

  // Cursor config — Cursor stores MCP config in ~/.cursor/mcp.json.
  const cursorPath =
    process.platform === "win32"
      ? `${home}\\.cursor\\mcp.json`
      : `${home}/.cursor/mcp.json`;
  if (existsSync(cursorPath)) {
    out.push({ id: "cursor", label: "Cursor", detail: cursorPath });
  } else {
    // Cursor without a config file is still a candidate — just check the dir.
    const cursorDir =
      process.platform === "win32"
        ? `${home}\\.cursor`
        : `${home}/.cursor`;
    if (existsSync(cursorDir)) {
      out.push({
        id: "cursor",
        label: "Cursor",
        detail: cursorPath + " (will be created)",
      });
    }
  }

  return out;
}

// CommonJS-style require shim — keeps `node:child_process` import path local
// (avoids top-level require / dynamic import cost).
function require_(mod: string): any {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return (createRequire(import.meta.url) as any)(mod);
}
import { createRequire } from "node:module";

async function readChoice(prompt: string, def = true): Promise<boolean> {
  const isTTY = process.stdin.isTTY === true && process.stdout.isTTY === true;
  if (!isTTY) return def; // non-interactive: take default
  process.stderr.write(`${prompt} ${def ? "[Y/n]" : "[y/N]"} `);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  return await new Promise<boolean>((resolve) => {
    const onData = (k: string) => {
      // Enter → take default
      if (k === "\r" || k === "\n") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", onData);
        process.stderr.write(def ? "y\n" : "n\n");
        return resolve(def);
      }
      if (k === "\u0003" || k === "\u0004") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stderr.write("\n");
        process.exit(130);
      }
      const lower = k.toLowerCase();
      if (lower === "y" || lower === "n") {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", onData);
        process.stderr.write(`${lower}\n`);
        return resolve(lower === "y");
      }
    };
    process.stdin.on("data", onData);
  });
}

async function installInClaudeCode(
  token: string,
  region: "us" | "fr",
  includeWrite: boolean
): Promise<{ ok: boolean; message: string }> {
  const cp = await import("node:child_process");
  const args = [
    "mcp",
    "add",
    "leadbay",
    "--env",
    `LEADBAY_TOKEN=${token}`,
    "--env",
    `LEADBAY_REGION=${region}`,
  ];
  if (includeWrite) args.push("--env", `LEADBAY_MCP_WRITE=1`);
  args.push("--", "npx", "-y", "@leadbay/mcp@0.2");
  return await new Promise((resolve) => {
    const child = cp.spawn("claude", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (c) => (stderr += c.toString()));
    child.on("close", (code) =>
      resolve({
        ok: code === 0,
        message: code === 0 ? "registered" : `claude mcp add exited ${code}: ${stderr.trim().slice(0, 200)}`,
      })
    );
    child.on("error", (err) =>
      resolve({ ok: false, message: `failed to spawn claude: ${err.message}` })
    );
  });
}

interface MCPConfigShape {
  mcpServers?: Record<string, {
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }>;
  // Cursor uses the same shape under "mcpServers" too.
}

async function installInJsonConfig(
  configPath: string,
  token: string,
  region: "us" | "fr",
  includeWrite: boolean
): Promise<{ ok: boolean; message: string }> {
  try {
    const { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } = await import("node:fs");
    const { dirname } = await import("node:path");

    let parsed: MCPConfigShape = {};
    let preserved: any = {};
    if (existsSync(configPath)) {
      const raw = readFileSync(configPath, "utf8");
      try {
        preserved = JSON.parse(raw);
        parsed = preserved;
      } catch {
        return { ok: false, message: `existing ${configPath} is not valid JSON; refusing to overwrite` };
      }
    } else {
      mkdirSync(dirname(configPath), { recursive: true });
    }

    parsed.mcpServers = parsed.mcpServers ?? {};
    const env: Record<string, string> = {
      LEADBAY_TOKEN: token,
      LEADBAY_REGION: region,
    };
    if (includeWrite) env.LEADBAY_MCP_WRITE = "1";

    parsed.mcpServers.leadbay = {
      command: "npx",
      args: ["-y", "@leadbay/mcp@0.2"],
      env,
    };

    // Atomic-ish write: write to .tmp then rename, restore mode if pre-existed.
    const tmp = configPath + ".tmp";
    writeFileSync(tmp, JSON.stringify(parsed, null, 2) + "\n", "utf8");
    const { renameSync, chmodSync } = await import("node:fs");
    renameSync(tmp, configPath);
    // Tighten perms: existing config may already be 0644; leave it. But for
    // newly-created configs (didn't exist before), enforce 0600.
    try {
      const st = statSync(configPath);
      if ((st.mode & 0o777) > 0o600 && Object.keys(preserved).length === 0) {
        chmodSync(configPath, 0o600);
      }
    } catch { /* best-effort */ }

    return { ok: true, message: "registered" };
  } catch (err: any) {
    return { ok: false, message: err?.message ?? String(err) };
  }
}

async function runInstall(args: string[]): Promise<number> {
  const email = parseFlag(args, "email");
  if (!email) {
    process.stderr.write(
      "Usage: leadbay-mcp install --email you@example.com [--region us|fr]\n" +
        "                          [--allow-region-fallback] [--include-write]\n" +
        "                          [--target claude-code,claude-desktop,cursor] [--yes]\n" +
        "  Mints a token AND registers the MCP server with your installed clients.\n" +
        "  --target            Comma-separated subset; default = all detected.\n" +
        "  --include-write     Enable LEADBAY_MCP_WRITE=1 (composite write tools — refine_prompt,\n" +
        "                      report_outreach, adjust_audience). Off by default; off means the\n" +
        "                      agent can read your Leadbay account but not mutate it.\n" +
        "  --yes               Don't ask before installing into each detected client.\n"
    );
    return 2;
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
  if (!pinnedRegion && !allowFallback) {
    process.stderr.write(
      "leadbay-mcp install: --region us|fr (or $LEADBAY_REGION) is required by default.\n" +
        "  This avoids sending your password to a Leadbay backend you don't use.\n" +
        "  Pass --allow-region-fallback to opt in to auto-detect (your password will hit BOTH backends if the first 401s).\n"
    );
    return 2;
  }

  // Detect clients.
  const detected = await detectClients();
  const targetArg = parseFlag(args, "target");
  let chosen = detected;
  if (targetArg) {
    const want = new Set(targetArg.split(",").map((s) => s.trim()));
    chosen = detected.filter((c) => want.has(c.id));
    const missing = [...want].filter((id) => !detected.some((c) => c.id === id));
    if (missing.length) {
      process.stderr.write(
        `leadbay-mcp install: --target requested [${[...want].join(", ")}] but these were not detected on this machine: ${missing.join(", ")}\n`
      );
      // Don't bail — proceed with what we have.
    }
  }
  if (chosen.length === 0) {
    process.stderr.write(
      "leadbay-mcp install: no MCP clients detected on this machine.\n" +
        "  Install Claude Code (https://docs.claude.com/claude-code), Claude Desktop, or Cursor first,\n" +
        "  or use `leadbay-mcp login --write-config /path/to/config.json` to mint a token without auto-install.\n"
    );
    return 1;
  }

  process.stderr.write(
    `\nleadbay-mcp install — detected MCP clients on this machine:\n`
  );
  for (const c of chosen) process.stderr.write(`  • ${c.label.padEnd(16)} ${c.detail}\n`);
  process.stderr.write("\n");

  // Prompt for password BEFORE asking confirmations — so users who change their
  // mind after typing the password don't have to redo it.
  const password = await readPassword();
  if (!password) {
    process.stderr.write("leadbay-mcp install: empty password\n");
    return 2;
  }

  // Mint token.
  let token: string;
  let region: "us" | "fr";
  try {
    if (pinnedRegion && !allowFallback) {
      const { REGIONS } = await import("@leadbay/core");
      const baseUrl = REGIONS[pinnedRegion];
      token = await loginAt(baseUrl, email, password);
      region = pinnedRegion;
    } else {
      const result = await resolveRegion(email, password, pinnedRegion ?? undefined);
      token = result.token;
      region = result.region;
    }
  } catch (err: any) {
    process.stderr.write(`leadbay-mcp install: ${err?.message ?? String(err)}\n`);
    return 1;
  }
  process.stderr.write(`Logged in to ${region.toUpperCase()} backend.\n\n`);

  const includeWrite = hasFlag(args, "include-write");
  if (!includeWrite) {
    process.stderr.write(
      "Note: write tools (refine_prompt, report_outreach, adjust_audience, etc.) are NOT enabled.\n" +
        "      Re-run with --include-write to enable them.\n\n"
    );
  }

  const skipPrompts = hasFlag(args, "yes");

  const results: Array<{ id: string; label: string; ok: boolean; message: string }> = [];
  for (const c of chosen) {
    const ok = skipPrompts || (await readChoice(`Install into ${c.label} (${c.detail})?`, true));
    if (!ok) {
      results.push({ id: c.id, label: c.label, ok: false, message: "skipped by user" });
      continue;
    }
    let res: { ok: boolean; message: string };
    if (c.id === "claude-code") {
      res = await installInClaudeCode(token, region, includeWrite);
    } else {
      // claude-desktop and cursor both use the same JSON shape.
      const path = c.detail.split(" ")[0];
      res = await installInJsonConfig(path, token, region, includeWrite);
    }
    results.push({ id: c.id, label: c.label, ...res });
  }

  process.stderr.write("\n=== install summary ===\n");
  let anyOk = false;
  for (const r of results) {
    process.stderr.write(`  ${r.ok ? "✓" : "✗"} ${r.label.padEnd(16)} ${r.message}\n`);
    if (r.ok) anyOk = true;
  }
  process.stderr.write(
    `\nThe token was written into client config files but never printed to your terminal.\n` +
      `Verify with: LEADBAY_TOKEN=$(...) npx -y @leadbay/mcp@0.2 doctor\n` +
      `Restart your MCP client(s) to pick up the new server.\n` +
      `If you ever leak the token, log in to app.leadbay.ai again to invalidate the prior session.\n`
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
          `Leadbay: your LEADBAY_TOKEN is not valid for ${region}. ${err.hint}\n`
        );
        return 1;
      }
      // fall through and try next region
    }
    if (baseUrl) break; // custom baseUrl — don't try other regions
  }
  process.stderr.write(
    "Leadbay doctor: could not reach any Leadbay region with this token. Check the token and your network.\n"
  );
  return 1;
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
  if (arg === "install") {
    process.exit(await runInstall(process.argv.slice(3)));
  }
  if (arg === "login") {
    process.exit(await runLogin(process.argv.slice(3)));
  }
  if (arg === "doctor") {
    process.exit(await runDoctor());
  }

  // Stdio MCP mode (default).
  const logger = makeStderrLogger(parseLogLevel(process.env.LEADBAY_LOG_LEVEL));
  const client = await resolveClientFromEnv(logger);
  const includeAdvanced = process.env.LEADBAY_MCP_ADVANCED === "1";
  const includeWrite = process.env.LEADBAY_MCP_WRITE === "1";

  // Bulk tracker: file-backed by default at ~/.leadbay/bulks.json.
  // Fails loudly unless LEADBAY_BULK_STORE_ALLOW_MEMORY=1 is set.
  const bulkTracker = await createDefaultBulkStore({ logger });

  const server = buildServer(client, {
    includeAdvanced,
    includeWrite,
    logger,
    bulkTracker,
  });
  const transport = new StdioServerTransport();
  logger.info?.(
    `Starting MCP server v${VERSION} (advanced=${includeAdvanced}, write=${includeWrite}, baseUrl=${client.baseUrl}, bulk_store=${bulkTracker.durability})`
  );
  await server.connect(transport);
}

// Only run main() when invoked as a CLI, not when imported by tests.
// import.meta.url === file://<argv[1]> ish — compare by resolved path.
const isEntrypoint = (() => {
  try {
    const entry = process.argv[1];
    if (!entry) return false;
    const url = new URL(import.meta.url);
    return url.pathname === entry || url.pathname.endsWith(entry);
  } catch {
    return false;
  }
})();

if (isEntrypoint) {
  main().catch((err) => {
    process.stderr.write(`leadbay-mcp: ${err?.message ?? err}\n`);
    process.exit(1);
  });
}
