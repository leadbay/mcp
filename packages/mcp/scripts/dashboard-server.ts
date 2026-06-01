#!/usr/bin/env tsx
/**
 * HTTP server that hosts the MCP telemetry dashboard (GitHub issue #3688).
 *
 * Regenerates the dashboard HTML on a fixed interval (default 60s) by running
 * the same generator used by the CLI (posthog-dashboard.ts), caches it in
 * memory, and serves it behind HTTP basic auth. Designed for Fly.io.
 *
 * Secrets/config come from the environment ONLY — never baked into the image:
 *
 *   POSTHOG_PERSONAL_API_KEY   (required)  forwarded to the generator
 *   POSTHOG_PROJECT_ID         (optional)  default 23333
 *   POSTHOG_HOST               (optional)  default https://eu.posthog.com
 *   DASHBOARD_USER             (required)  basic-auth username
 *   DASHBOARD_PASSWORD         (required)  basic-auth password
 *   DASHBOARD_DAYS             (optional)  lookback window, default 30
 *   DASHBOARD_REFRESH_MS       (optional)  regen interval ms, default 60000
 *   PORT                       (optional)  default 8080
 *
 * Routes:
 *   GET /healthz   → 200 "ok" (no auth) — for Fly health checks
 *   GET /          → basic-auth → cached dashboard HTML (auto-refreshes in browser)
 */

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFileSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";

const PORT = parseInt(process.env.PORT ?? "8080", 10);
const REFRESH_MS = parseInt(process.env.DASHBOARD_REFRESH_MS ?? "60000", 10);
const DAYS = process.env.DASHBOARD_DAYS ?? "30";
const USER = process.env.DASHBOARD_USER;
const PASS = process.env.DASHBOARD_PASSWORD;

const here = dirname(fileURLToPath(import.meta.url));
const workdir = mkdtempSync(join(tmpdir(), "mcp-dash-"));
const OUT_HTML = join(workdir, "dashboard.html");

// Prefer the precompiled JS generator (run with plain node — no per-refresh
// tsx/esbuild compile, which is what OOM-killed the small machine). Fall back
// to tsx + the .ts source for local dev where nothing is compiled.
const COMPILED = join(here, "posthog-dashboard.js"); // present in the Docker image (dist/)
const SOURCE = join(here, "posthog-dashboard.ts");
const useCompiled = existsSync(COMPILED);
const GENERATOR_ARGV: string[] = useCompiled
  ? [COMPILED]
  : [join(here, "node_modules", "tsx", "dist", "cli.mjs"), SOURCE];

if (!process.env.POSTHOG_PERSONAL_API_KEY) {
  console.error("Missing POSTHOG_PERSONAL_API_KEY (set as a Fly secret).");
  process.exit(1);
}
if (!USER || !PASS) {
  console.error("Missing DASHBOARD_USER / DASHBOARD_PASSWORD (set as Fly secrets).");
  process.exit(1);
}

// In-memory cache of the latest rendered dashboard.
let cachedHtml = "<!DOCTYPE html><title>MCP Dashboard</title><body>Generating…</body>";
let lastGeneratedAt = 0;
let lastError: string | null = null;

// Inject a browser auto-refresh so the open tab pulls the freshly-cached HTML.
function withAutoRefresh(html: string): string {
  const meta = `<meta http-equiv="refresh" content="${Math.round(REFRESH_MS / 1000)}">`;
  return html.includes("<head>") ? html.replace("<head>", `<head>${meta}`) : meta + html;
}

// Run the generator as a subprocess (reuses the exact CLI logic → identical
// output). Inherits this process's env, so POSTHOG_* secrets flow through.
function regenerate(): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [...GENERATOR_ARGV, "--days", DAYS, "--out", OUT_HTML],
      { env: process.env, stdio: ["ignore", "ignore", "pipe"] }
    );
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      if (code === 0) {
        try {
          cachedHtml = withAutoRefresh(readFileSync(OUT_HTML, "utf8"));
          lastGeneratedAt = Date.now();
          lastError = null;
          console.log(`[dashboard] regenerated ok @ ${new Date().toISOString()}`);
        } catch (err) {
          lastError = `read failed: ${(err as Error).message}`;
          console.error(`[dashboard] ${lastError}`);
        }
      } else {
        // Redact any accidental key echo from generator stderr.
        lastError = `generator exited ${code}: ${stderr.replace(/phx_[A-Za-z0-9]+/g, "phx_***").slice(0, 400)}`;
        console.error(`[dashboard] ${lastError}`);
      }
      resolve();
    });
  });
}

// Constant-time credential check.
function authOk(header: string | undefined): boolean {
  if (!header?.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  const sep = decoded.indexOf(":");
  if (sep < 0) return false;
  const u = decoded.slice(0, sep);
  const p = decoded.slice(sep + 1);
  const expU = USER as string;
  const expP = PASS as string;
  const eq = (a: string, b: string) => {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    return ab.length === bb.length && timingSafeEqual(ab, bb);
  };
  return eq(u, expU) && eq(p, expP);
}

const server = createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  if (!authOk(req.headers.authorization)) {
    res.writeHead(401, {
      "www-authenticate": 'Basic realm="MCP Dashboard"',
      "content-type": "text/plain",
    });
    res.end("Authentication required");
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(cachedHtml);
});

server.listen(PORT, () => {
  console.log(`[dashboard] listening on :${PORT}, refresh every ${REFRESH_MS}ms`);
  // First generation immediately, then on the interval.
  regenerate();
  setInterval(regenerate, REFRESH_MS);
});
