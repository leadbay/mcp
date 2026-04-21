import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient, LeadbayClient, type CreateClientConfig, type ToolLogger } from "@leadbay/core";
import { buildServer } from "./server.js";

const VERSION = "0.1.0";

const HELP = `
leadbay-mcp ${VERSION} — Leadbay Model Context Protocol server

USAGE
  leadbay-mcp            Run the MCP stdio server (for Claude Desktop, Cursor, etc.)
  leadbay-mcp doctor     Validate your token, probe your region, print account + quota.
  leadbay-mcp --version  Print version
  leadbay-mcp --help     Print this help

ENV VARS
  LEADBAY_TOKEN          (required) Bearer token from https://app.leadbay.ai/settings/api-tokens
  LEADBAY_REGION         (optional) "us" or "fr". Auto-detected from /users/me if unset.
  LEADBAY_BASE_URL       (optional) Override API base URL (for staging/dev).
  LEADBAY_MCP_ADVANCED   (optional) Set to "1" to expose 10 granular tools alongside
                         the 3 composite workflow tools. Most users don't need this.
  LEADBAY_LOG_LEVEL      (optional) "debug" | "info" | "error" (default "error"). Logs to stderr.
  LEADBAY_TIMEOUT_MS     (optional) Per-request timeout override (not yet plumbed).

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

  // Otherwise probe both regions in parallel and pick whichever /users/me
  // resolves first. This keeps us-region users on fast path while letting
  // fr users work without setting LEADBAY_REGION.
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
  if (arg === "doctor") {
    process.exit(await runDoctor());
  }

  // Stdio MCP mode (default).
  const logger = makeStderrLogger(parseLogLevel(process.env.LEADBAY_LOG_LEVEL));
  const client = await resolveClientFromEnv(logger);
  const includeAdvanced = process.env.LEADBAY_MCP_ADVANCED === "1";

  const server = buildServer(client, { includeAdvanced, logger });
  const transport = new StdioServerTransport();
  logger.info?.(
    `Starting MCP server (advanced=${includeAdvanced}, baseUrl=${client.baseUrl})`
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
