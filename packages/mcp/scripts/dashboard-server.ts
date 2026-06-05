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
 *   DASHBOARD_DAYS             (optional)  default lookback window, default 30
 *   DASHBOARD_REFRESH_MS       (optional)  regen interval ms, default 60000
 *   PORT                       (optional)  default 8080
 *
 * Routes:
 *   GET /healthz                  → 200 "ok" (no auth) — for Fly health checks
 *   GET /?days=N                  → basic-auth → dashboard for the last N days
 *   GET /?start=YYYY-MM-DD&end=…  → basic-auth → dashboard for an explicit range
 *   GET /                         → basic-auth → dashboard for the default window
 *
 * Each distinct range is generated on demand and cached separately (small LRU),
 * so switching ranges from the UI is cheap after the first visit and the
 * background refresh keeps the most-recently-viewed ranges warm.
 */

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { timingSafeEqual } from "node:crypto";

const PORT = parseInt(process.env.PORT ?? "8080", 10);
const REFRESH_MS = parseInt(process.env.DASHBOARD_REFRESH_MS ?? "60000", 10);
const DAYS = process.env.DASHBOARD_DAYS ?? "30";
const USER = process.env.DASHBOARD_USER;
const PASS = process.env.DASHBOARD_PASSWORD;

const here = dirname(fileURLToPath(import.meta.url));
// Stable (not random) workdir so generated HTML SURVIVES a process reboot. The
// 512MB machine reboots under memory pressure; a fresh mkdtemp each boot lost
// every cached range, so the page looped on "Generating…" forever. A fixed
// path lets a reboot reload prior HTML from disk instead of regenerating.
const workdir = process.env.DASHBOARD_CACHE_DIR ?? "/tmp/mcp-dash-cache";
try {
  mkdirSync(workdir, { recursive: true });
} catch {
  /* already exists */
}

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

// ── Range parsing ──────────────────────────────────────────────────────────
// A range is either {days:N} or {start,end}. We normalise to a stable cache key
// and to the generator argv. Inputs are validated hard — only digits / ISO
// dates reach the subprocess, so the query string can't inject extra flags.
type Range = { key: string; argv: string[]; label: string };
const isISODate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s);
const DEFAULT_RANGE: Range = { key: `days:${DAYS}`, argv: ["--days", DAYS], label: `last ${DAYS}d` };

function parseRange(url: string): Range {
  const q = new URLSearchParams(url.split("?")[1] ?? "");
  const start = q.get("start") ?? "";
  const end = q.get("end") ?? "";
  if (isISODate(start) && isISODate(end) && start <= end) {
    return { key: `range:${start}:${end}`, argv: ["--start", start, "--end", end], label: `${start} → ${end}` };
  }
  const days = q.get("days") ?? "";
  if (/^\d{1,5}$/.test(days)) {
    return { key: `days:${days}`, argv: ["--days", days], label: `last ${days}d` };
  }
  return DEFAULT_RANGE;
}

// Per-range cache is DISK-BACKED — the generated HTML lives in a file under
// `workdir`, NOT in memory. Two reasons: (1) the 512MB machine OOM-reboots when
// it holds several multi-MB HTML strings in memory, and (2) on-disk files
// survive a reboot, so a restart serves the last good page instead of looping
// on "Generating…". The in-memory map is just a tiny index (path + timestamp),
// rebuilt from disk on boot.
const MAX_CACHED_RANGES = 12;
type Entry = { file: string; generatedAt: number; servedAt: number };
const cache = new Map<string, Entry>();
const fileFor = (key: string): string =>
  join(workdir, `dash-${key.replace(/[^a-z0-9]/gi, "_")}.html`);
// Per-range last error (cleared on success). Lets the placeholder surface a
// failure + offer retry instead of looping on "Generating…" forever.
const rangeError = new Map<string, string>();
// Hard ceiling on a single generation so a stuck subprocess can't pin a slot
// forever. Generous (the drill-down is now capped, so real runs are well under).
const GEN_TIMEOUT_MS = 170_000;
// Exit code the generator uses to signal "PostHog rate-limited me, back off".
const EXIT_THROTTLED = 75;
// When throttled, pause ALL generation until this timestamp. Stops the server
// from hammering an already-rate-limited key (which only extends the throttle).
let throttledUntil = 0;

// Browser auto-refresh that PRESERVES the current ?days/?start/?end query string
// (a plain <meta refresh> would drop it and snap back to the default range).
function withAutoRefresh(html: string): string {
  const js = `<script>setTimeout(function(){location.reload();}, ${REFRESH_MS});</script>`;
  return html.includes("</body>") ? html.replace("</body>", `${js}</body>`) : html + js;
}

function evictIfNeeded(): void {
  if (cache.size <= MAX_CACHED_RANGES) return;
  let oldestKey: string | null = null;
  let oldest = Infinity;
  for (const [k, v] of cache) if (v.servedAt < oldest) (oldest = v.servedAt), (oldestKey = k);
  if (oldestKey) cache.delete(oldestKey); // file left on disk; harmless, overwritten on regen
}

// Run the generator for a specific range as a subprocess (reuses the exact CLI
// logic → identical output). Inherits env, so POSTHOG_* secrets flow through.
// The HTML is written to disk by the generator (--out); we keep only the PATH
// in memory, never the HTML string, to keep the 512MB machine off the OOM line.
function regenerate(range: Range): Promise<void> {
  const out = fileFor(range.key);
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [...GENERATOR_ARGV, ...range.argv, "--out", out],
      { env: process.env, stdio: ["ignore", "ignore", "pipe"] }
    );
    let stderr = "";
    let timedOut = false;
    child.stderr.on("data", (d) => (stderr += d.toString()));
    // Hard timeout — kill a stuck subprocess so it can't pin the in-flight slot
    // forever (the bug that made the page loop on "Generating…").
    const killer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, GEN_TIMEOUT_MS);
    child.on("close", (code) => {
      clearTimeout(killer);
      if (code === 0) {
        try {
          if (!existsSync(out)) throw new Error("generator exited 0 but wrote no file");
          const prev = cache.get(range.key);
          cache.set(range.key, {
            file: out,
            generatedAt: Date.now(),
            servedAt: prev?.servedAt ?? Date.now(),
          });
          evictIfNeeded();
          rangeError.delete(range.key);
          console.log(`[dashboard] regenerated ${range.label} @ ${new Date().toISOString()}`);
        } catch (err) {
          const msg = `read failed: ${(err as Error).message}`;
          rangeError.set(range.key, msg);
          console.error(`[dashboard] ${range.label}: ${msg}`);
        }
      } else if (code === EXIT_THROTTLED) {
        // Rate-limited. Back off ALL generation for a cooldown so we stop
        // hammering the key. Parse the wait hint from stderr if present.
        const m = stderr.match(/retry in ~(\d+)s/);
        const waitS = m ? Math.min(parseInt(m[1], 10), 300) : 120;
        throttledUntil = Date.now() + waitS * 1000;
        const msg = `PostHog rate-limited — backing off ~${waitS}s. The key is shared; try again shortly.`;
        rangeError.set(range.key, msg);
        console.error(`[dashboard] ${range.label}: throttled, cooldown ${waitS}s`);
      } else {
        const msg = timedOut
          ? `generation timed out after ${Math.round(GEN_TIMEOUT_MS / 1000)}s`
          : `generator exited ${code}: ${stderr.replace(/phx_[A-Za-z0-9]+/g, "phx_***").slice(0, 400)}`;
        rangeError.set(range.key, msg);
        console.error(`[dashboard] ${range.label}: ${msg}`);
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

// Per-range guard so a manual refresh can't overlap an in-flight regen for the
// SAME range (which would double memory + double-hit PostHog's 3-concurrent
// query cap). Different ranges may regen concurrently — fine, they're separate.
const inFlight = new Set<string>();
async function regenerateGuarded(range: Range): Promise<void> {
  if (inFlight.has(range.key)) return;
  // Respect the global throttle cooldown — don't hammer a rate-limited key.
  if (Date.now() < throttledUntil) {
    if (!rangeError.has(range.key)) {
      const s = Math.ceil((throttledUntil - Date.now()) / 1000);
      rangeError.set(range.key, `PostHog rate-limited — backing off ~${s}s. Try again shortly.`);
    }
    return;
  }
  inFlight.add(range.key);
  try {
    await regenerate(range);
  } finally {
    inFlight.delete(range.key);
  }
}

const server = createServer((req, res) => {
  const url = req.url ?? "/";
  if (url === "/healthz") {
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
  const range = parseRange(url);
  // Manual refresh: kick a regeneration of the CURRENT range (non-blocking).
  // 202 = started, 409 = one already running for this range. Page polls + reloads.
  if (url.split("?")[0] === "/refresh") {
    if (inFlight.has(range.key)) {
      res.writeHead(409, { "content-type": "text/plain" });
      res.end("busy");
      return;
    }
    regenerateGuarded(range);
    res.writeHead(202, { "content-type": "text/plain" });
    res.end("refreshing");
    return;
  }
  // Serve the cached HTML for this range — read from disk on demand (kept off
  // the heap so the small machine doesn't OOM). On a cache miss, kick
  // generation and serve a "Generating…" placeholder that reloads itself.
  const entry = cache.get(range.key);
  if (entry) {
    try {
      const html = withAutoRefresh(readFileSync(entry.file, "utf8"));
      entry.servedAt = Date.now();
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    } catch {
      // File vanished (evicted / reboot cleared /tmp) — drop the index entry
      // and fall through to regenerate.
      cache.delete(range.key);
    }
  }
  // Cache miss in memory — but the HTML file may still be ON DISK from before a
  // reboot (the index is in-memory and lost on restart; the file is not). If a
  // recent file exists, adopt it and serve immediately — this is what makes a
  // reboot transparent instead of dropping back to "Generating…".
  const onDisk = fileFor(range.key);
  if (existsSync(onDisk)) {
    try {
      const ageMs = Date.now() - statSync(onDisk).mtimeMs;
      const html = withAutoRefresh(readFileSync(onDisk, "utf8"));
      cache.set(range.key, { file: onDisk, generatedAt: Date.now() - ageMs, servedAt: Date.now() });
      // If it's stale, kick a background refresh but still serve the stale copy now.
      if (ageMs > REFRESH_MS) regenerateGuarded(range);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    } catch {
      /* fall through to regenerate */
    }
  }
  // True cold miss. If the last attempt for this range FAILED and nothing is
  // currently generating, show the error + a retry button instead of looping
  // forever. Otherwise kick generation and show a self-reloading placeholder.
  const err = rangeError.get(range.key);
  const generating = inFlight.has(range.key);
  if (!generating) regenerateGuarded(range);
  const css = `body{background:#0d1117;color:#e6edf3;font:15px/1.6 -apple-system,sans-serif;padding:48px}` +
    `a,button{color:#58a6ff}.box{max-width:680px}code{background:#161b22;padding:2px 6px;border-radius:5px}` +
    `button{background:#21262d;border:1px solid #30363d;border-radius:6px;padding:6px 14px;font-size:14px;cursor:pointer;margin-top:16px}`;
  if (err && !generating) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>MCP Dashboard</title><style>${css}</style></head>` +
        `<body><div class="box"><h2>Couldn’t generate <strong>${range.label}</strong></h2>` +
        `<p><code>${err.replace(/[<>&]/g, "")}</code></p>` +
        `<p>This usually clears on its own (PostHog rate-limit). Try again:</p>` +
        `<button onclick="location.reload()">↻ Retry</button> ` +
        `<button onclick="location.href='/'">← Back to default range</button></div></body></html>`
    );
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>MCP Dashboard</title>` +
      `<script>setTimeout(function(){location.reload();},5000);</script><style>${css}</style></head>` +
      `<body><div class="box">Generating dashboard for <strong>${range.label}</strong>… first load can take up to ~60s. ` +
      `The page refreshes automatically.</div></body></html>`
  );
});

server.listen(PORT, () => {
  console.log(`[dashboard] listening on :${PORT}, refresh every ${REFRESH_MS}ms`);
  // Warm the default range immediately.
  regenerateGuarded(DEFAULT_RANGE);
  // On the interval, refresh every range currently in the cache so open tabs
  // (whatever range they're viewing) stay fresh. The default range is always
  // included so a cold cache still gets refreshed.
  setInterval(() => {
    const ranges = cache.size ? [...cache.keys()] : [DEFAULT_RANGE.key];
    for (const key of ranges) {
      // Reconstruct a Range from the key (days:N or range:start:end).
      if (key.startsWith("days:")) {
        const n = key.slice(5);
        regenerateGuarded({ key, argv: ["--days", n], label: `last ${n}d` });
      } else if (key.startsWith("range:")) {
        const [, s, e] = key.split(":");
        regenerateGuarded({ key, argv: ["--start", s, "--end", e], label: `${s} → ${e}` });
      }
    }
  }, REFRESH_MS);
});
