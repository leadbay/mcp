import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { installInClaudeCode, isLeadbayConfiguredInClaudeCode, uninstallFromClaudeCode } from "./install-claude-code.js";
import { installInJsonConfig, uninstallFromJsonConfig } from "./install-json-config.js";
import { appendShellExports, installInCodexConfig, uninstallFromCodexConfig, uninstallShellExports } from "./install-codex.js";
import { removeDxtExtension } from "./install-dxt.js";
import { existsSync, readFileSync } from "node:fs";
import {
  detectClients,
  formatInstallOsLabel,
  HOSTED_MCP_URL,
  type DetectedClient,
} from "./install-shared.js";
import { inferRegionViaStargate, oauthLogin } from "../src/oauth.js";

declare const __LEADBAY_MCP_VERSION__: string;

type InstallRequest = { sessionId?: string; clientIds?: string[]; includeWrite?: boolean; telemetryEnabled?: boolean };
type LoginSession = { token: string; region: "us" | "fr"; accountLabel: string; createdAt: number };
type InstallResult = { id: string; label: string; ok: boolean; message: string };
type LogLevel = "info" | "active" | "success" | "error" | "done";

const VERSION = __LEADBAY_MCP_VERSION__;

// Leadbay wordmark icon — the stacked-pages mark, inline so the installer
// has zero external asset dependencies (CSP-safe, no network fetch).
const LEADBAY_LOGO_SVG =
  '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
  '<path d="M12 5.2C9.7 3.9 6.8 3.6 4 4.4v13.2c2.8-.8 5.7-.5 8 .8 2.3-1.3 5.2-1.6 8-.8V4.4c-2.8-.8-5.7-.5-8 .8Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>' +
  '<path d="M12 5.2V18.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
  '</svg>';
const PORT = Number(process.env.LEADBAY_INSTALLER_PORT ?? 0);
const sessions = new Map<string, LoginSession>();
const OAUTH_BASE_URLS = {
  prod: {
    us: "https://api-us.leadbay.app",
    fr: "https://api-fr.leadbay.app",
  },
} as const;

export type InstallerGuiOptions = { openBrowser?: boolean; port?: number };

// Returns true when the client already has a leadbay MCP entry configured.
async function isLeadbayConfigured(client: DetectedClient): Promise<boolean> {
  if (client.id === "claude-code") {
    return await isLeadbayConfiguredInClaudeCode();
  }
  if (client.id === "codex") {
    const configPath = client.detail;
    if (!existsSync(configPath)) return false;
    try {
      return readFileSync(configPath, "utf8").includes("[mcp_servers.leadbay]");
    } catch { return false; }
  }
  if (client.id === "chatgpt-desktop") return false;
  // claude-desktop and cursor: JSON config
  const configPath = client.configPath;
  if (!configPath || !existsSync(configPath)) return false;
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    return Boolean(parsed?.mcpServers?.leadbay);
  } catch { return false; }
}

async function clientsWithConfiguredStatus(): Promise<Array<DetectedClient & { configured: boolean }>> {
  const clients = await detectClients();
  return await Promise.all(
    clients.map(async (client) => ({
      ...client,
      configured: await isLeadbayConfigured(client),
    }))
  );
}
export type InstallerGuiHandle = { url: string; close: () => Promise<void>; done: Promise<void> };

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(raw),
  });
  res.end(raw);
}

function sendSse(res: ServerResponse, event: unknown): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function cleanupSessions(): void {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, session] of sessions) {
    if (session.createdAt < cutoff) sessions.delete(id);
  }
}

async function loginWithOAuth(): Promise<{ ok: boolean; sessionId?: string; region?: string; accountLabel?: string; error?: string }> {
  cleanupSessions();

  try {
    const region = await inferRegionViaStargate({ staging: false });
    const { hostname } = await import("node:os");
    const { accessToken } = await oauthLogin({
      authServerBaseUrl: OAUTH_BASE_URLS.prod[region],
      clientName: `Leadbay MCP installer @ ${hostname()}`,
      log: () => undefined,
    });
    const sessionId = randomUUID();
    const accountLabel = `Leadbay OAuth (${region.toUpperCase()})`;
    sessions.set(sessionId, { token: accessToken, region, accountLabel, createdAt: Date.now() });
    return { ok: true, sessionId, region, accountLabel };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

export function sanitizeOutput(raw: string): string {
  return raw.replace(/LEADBAY_TOKEN=("[^"]+"|'[^']+'|[^\s]+)/g, "LEADBAY_TOKEN=<redacted>");
}

function isManualSetupClient(client: DetectedClient): boolean {
  return client.id === "chatgpt-desktop";
}

// Reject cross-origin requests. The server binds to 127.0.0.1 only, but a
// malicious webpage could enumerate the port and POST to /api/oauth-login or
// /api/install without user consent. Browsers send an Origin header on
// cross-origin fetches/EventSource requests; we use that + Host to block them.
function isAllowedOrigin(req: IncomingMessage, expectedHost: string): boolean {
  const host = req.headers["host"] ?? "";
  if (host !== expectedHost) return false;
  const origin = req.headers["origin"];
  if (!origin) return true; // same-origin browser request or direct tool call
  return origin === `http://${expectedHost}` || origin === `http://127.0.0.1`;
}

// Resolved once at startup from --local / --local=PATH on process.argv.
const LOCAL_BIN_PATH: string | undefined = (() => {
  const flag = process.argv.find(a => a === "--local" || a.startsWith("--local="));
  if (!flag) return undefined;
  const explicit = flag.startsWith("--local=") ? flag.slice("--local=".length) : "";
  if (explicit) {
    // Resolve against cwd so relative paths become absolute before being
    // written into client configs (clients launch from their own directory).
    return resolvePath(process.cwd(), explicit);
  }
  // Bare --local: resolve dist/bin.js next to this bundle. Uses static ESM
  // imports (no require()) so this works in the bundled ESM output.
  const here = typeof __dirname !== "undefined"
    ? __dirname
    : resolvePath(fileURLToPath(import.meta.url), "..");
  return resolvePath(here, "..", "dist", "bin.js");
})();

async function installInto(client: DetectedClient, session: LoginSession, includeWrite: boolean, telemetryEnabled: boolean): Promise<InstallResult> {
  let res: { ok: boolean; message: string };
  if (client.id === "claude-code") {
    res = await installInClaudeCode(session.token, session.region, includeWrite, telemetryEnabled, LOCAL_BIN_PATH);
  } else if (client.id === "codex") {
    const configRes = await installInCodexConfig(client.configPath ?? client.detail, includeWrite, telemetryEnabled, LOCAL_BIN_PATH);
    if (!configRes.ok) {
      res = configRes;
    } else {
      const exportRes = await appendShellExports(session.token, session.region, includeWrite, telemetryEnabled);
      res = exportRes.ok
        ? { ok: true, message: `${configRes.message}; ${exportRes.message}` }
        : { ok: false, message: `config ${configRes.message}; ${exportRes.message}` };
    }
  } else if (client.id === "chatgpt-desktop") {
    res = { ok: true, message: "manual setup required; add this MCP URL in ChatGPT Settings > Apps: " + HOSTED_MCP_URL };
  } else if (client.id === "claude-desktop" && client.mode?.dxt && client.supportDir) {
    const dxtResult = await removeDxtExtension(client.supportDir);
    const jsonResult = await installInJsonConfig(client.configPath!, session.token, session.region, includeWrite, telemetryEnabled, LOCAL_BIN_PATH);
    if (!jsonResult.ok) {
      res = jsonResult;
    } else {
      res = {
        ok: true,
        message: dxtResult.removed
          ? `DXT extension removed; ${jsonResult.message}`
          : jsonResult.message,
      };
    }
  } else {
    res = await installInJsonConfig(client.configPath!, session.token, session.region, includeWrite, telemetryEnabled, LOCAL_BIN_PATH);
  }
  return { id: client.id, label: client.label, ...res };
}

export async function install(body: InstallRequest): Promise<{ ok: boolean; output: string; results?: InstallResult[] }> {
  cleanupSessions();
  const session = body.sessionId ? sessions.get(body.sessionId) : undefined;
  const clientIds = body.clientIds ?? [];
  if (!session) return { ok: false, output: "Login expired. Go back and sign in again." };
  if (!clientIds.length) return { ok: false, output: "Select at least one agent." };

  const detected = await detectClients();
  const selected = detected.filter((client) => clientIds.includes(client.id));
  if (!selected.length) return { ok: false, output: "No selected agents were detected on this machine." };

  const includeWrite = body.includeWrite !== false;
  const telemetryEnabled = body.telemetryEnabled !== false;
  const results: InstallResult[] = [];
  for (const client of selected) results.push(await installInto(client, session, includeWrite, telemetryEnabled));

  const output = [
    `Logged in to ${session.region.toUpperCase()} backend.`,
    `Settings: write tools ${includeWrite ? "on" : "off"}, telemetry ${telemetryEnabled ? "on" : "off"}.`,
    "",
    "Install summary:",
    ...results.map((result) => `${result.ok ? "OK" : "ERROR"} ${result.label}: ${result.message}`),
    "",
    "Restart your MCP client(s) to pick up the new server.",
  ].join("\n");
  return { ok: results.some((result) => result.ok), output: sanitizeOutput(output), results };
}

async function streamInstall(url: URL, res: ServerResponse, onDone?: () => void): Promise<void> {
  cleanupSessions();
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });

  const session = sessions.get(url.searchParams.get("sessionId") ?? "");
  const clientIds = (url.searchParams.get("clients") ?? "").split(",").filter(Boolean);
  const includeWrite = url.searchParams.get("write") !== "0";
  const telemetryEnabled = url.searchParams.get("telemetry") !== "0";
  const emit = (level: LogLevel, message: string) => sendSse(res, { level, message: sanitizeOutput(message) });

  // abort: recoverable error — close the stream but leave the server running so the user can retry.
  const abort = (msg: string) => { emit("done", msg); res.end(); };
  // finish: successful completion — close stream and signal the process to exit.
  const finish = (msg: string) => { emit("done", msg); res.end(); onDone?.(); };

  if (!session) { emit("error", "Login expired. Go back and sign in again."); abort("Install stopped."); return; }
  if (!clientIds.length) { emit("error", "Select at least one agent."); abort("Install stopped."); return; }

  emit("info", `Connected to ${session.accountLabel}.`);
  emit("info", `Write tools ${includeWrite ? "enabled" : "disabled"}; telemetry ${telemetryEnabled ? "enabled" : "disabled"}.`);
  emit("info", "Refreshing installed-agent detection...");

  const detected = await detectClients();
  const selected = detected.filter((client) => clientIds.includes(client.id));
  const selectedHasOnlyManualSetup = selected.length > 0 && selected.every(isManualSetupClient);
  if (!selected.length) { emit("error", "No selected agents were detected on this machine."); abort("Install stopped."); return; }

  let okCount = 0;
  for (const client of selected) {
    emit("active", isManualSetupClient(client) ? `Preparing ${client.label} manual setup...` : `Installing ${client.label}...`);
    const result = await installInto(client, session, includeWrite, telemetryEnabled);
    if (result.ok) { okCount += 1; emit("success", `${result.label}: ${result.message}`); }
    else { emit("error", `${result.label}: ${result.message}`); }
  }

  const summary = selectedHasOnlyManualSetup ? "Manual ChatGPT setup instructions ready." : `${okCount}/${selected.length} agent(s) installed, updated, or prepared.`;
  const closing = selectedHasOnlyManualSetup ? "Follow the manual setup instructions shown above." : "Restart your MCP client(s) to pick up the new server.";
  emit(okCount > 0 ? "success" : "error", summary);
  // Only exit the process when at least one install succeeded — all-failed is
  // recoverable and the user should be able to retry in the same wizard.
  if (okCount > 0) { finish(closing); } else { abort(closing); }
}

async function streamUninstall(url: URL, res: ServerResponse, onDone?: () => void): Promise<void> {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });

  const clientIds = (url.searchParams.get("clients") ?? "").split(",").filter(Boolean);
  const emit = (level: LogLevel, message: string) => sendSse(res, { level, message });
  const abort = (msg: string) => { emit("done", msg); res.end(); };
  const finish = (msg: string) => { emit("done", msg); res.end(); onDone?.(); };

  if (!clientIds.length) { emit("error", "Select at least one agent."); abort("Uninstall stopped."); return; }

  const detected = await detectClients();
  const selected = detected.filter((c) => clientIds.includes(c.id));
  if (!selected.length) { emit("error", "No selected agents were detected on this machine."); abort("Uninstall stopped."); return; }

  let okCount = 0;
  for (const client of selected) {
    emit("active", `Removing from ${client.label}...`);
    let res2: { ok: boolean; message: string };
    if (client.id === "claude-code") {
      res2 = await uninstallFromClaudeCode();
    } else if (client.id === "codex") {
      const tomlRes = await uninstallFromCodexConfig(client.configPath ?? client.detail);
      const shellRes = await uninstallShellExports();
      res2 = tomlRes.ok && shellRes.ok
        ? { ok: true, message: `${tomlRes.message}; ${shellRes.message}` }
        : { ok: false, message: `toml: ${tomlRes.message}; shell: ${shellRes.message}` };
    } else {
      res2 = await uninstallFromJsonConfig(client.configPath!);
    }
    if (res2.ok) { okCount += 1; emit("success", `${client.label}: ${res2.message}`); }
    else { emit("error", `${client.label}: ${res2.message}`); }
  }

  emit(okCount > 0 ? "success" : "error", `${okCount}/${selected.length} agent(s) removed.`);
  finish("Restart your MCP client(s) to complete the removal.");
}

function pageUninstallHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Leadbay MCP uninstaller</title>
  <style>
    :root { color-scheme: light dark; --bg:#fff; --panel:#fff; --ink:#0d0f0e; --text:#0d0f0e; --muted:#7b837e; --line:#e7eae8; --soft:#f6f7f5; --danger:#b42318; --ok:#0e9f6e; --warn:#b06a00; --shadow:0 24px 60px rgba(13,15,14,.10); }
    @media (prefers-color-scheme: dark) { :root { --bg:#0c0e0d; --panel:#141716; --ink:#fff; --text:#f2f5f3; --muted:#9aa39d; --line:#262b28; --soft:#1a1e1c; --shadow:0 24px 60px rgba(0,0,0,.4); } }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100vh; background:var(--bg); color:var(--text); font:15px/1.5 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif; display:grid; place-items:center; padding:32px; -webkit-font-smoothing:antialiased; }
    main { width:min(640px,100%); position:relative; background:var(--panel); border:1px solid var(--line); border-radius:22px; box-shadow:var(--shadow); overflow:hidden; }
    header { padding:26px 30px 0; display:flex; align-items:center; justify-content:space-between; gap:16px; }
    .brand { display:flex; align-items:center; gap:10px; font-weight:800; font-size:18px; letter-spacing:-.01em; color:var(--ink); }
    .brand svg { display:block; }
    .badge { font-size:12px; font-weight:700; color:var(--muted); border:1px solid var(--line); border-radius:999px; padding:4px 11px; white-space:nowrap; }
    .head { padding:22px 30px 4px; }
    h1 { font-size:27px; line-height:1.1; margin:0 0 6px; letter-spacing:-.02em; font-weight:800; color:var(--ink); }
    .meta,.hint,.detail { color:var(--muted); }
    .meta { font-size:13px; }
    .steps { display:flex; gap:8px; padding:14px 30px 0; }
    .dot { flex:1; height:4px; border-radius:999px; background:var(--line); }
    .dot.active,.dot.done { background:var(--danger); }
    section { padding:18px 30px 6px; }
    .hidden { display:none; }
    .lead { font-size:16px; font-weight:650; color:var(--ink); margin:0 0 2px; }
    .agents { display:grid; gap:10px; margin-top:14px; }
    .agent { display:grid; grid-template-columns:auto 1fr; gap:12px; align-items:center; padding:14px 16px; border:1px solid var(--line); border-radius:14px; cursor:pointer; }
    .agent strong { display:block; font-weight:700; color:var(--ink); }
    .agent .detail { font-size:12.5px; word-break:break-all; }
    .agent input { width:18px; height:18px; accent-color:var(--danger); }
    .actions { display:flex; justify-content:space-between; gap:10px; padding:16px 30px 22px; }
    .right-actions { display:flex; gap:10px; }
    button { min-height:44px; border-radius:999px; border:1px solid var(--line); background:transparent; color:var(--text); padding:10px 20px; font:inherit; font-weight:700; cursor:pointer; transition:opacity .15s,transform .05s; }
    button:active { transform:translateY(1px); }
    button.danger { background:var(--danger); border-color:var(--danger); color:#fff; padding:10px 26px; }
    button.danger:hover { opacity:.88; }
    button.ghost { border-color:transparent; color:var(--muted); }
    button:disabled { opacity:.45; cursor:default; }
    .log-panel { margin:0; background:var(--soft); border-top:1px solid var(--line); padding:14px 30px; min-height:64px; max-height:240px; overflow:auto; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:12.5px; }
    .log-row { display:flex; gap:10px; align-items:flex-start; padding:3px 0; white-space:pre-wrap; word-break:break-word; }
    .log-row::before { width:48px; flex:0 0 48px; font-weight:800; text-transform:uppercase; font-size:10px; letter-spacing:.04em; opacity:.8; }
    .log-info { color:var(--muted); } .log-info::before { content:"info"; }
    .log-active { color:var(--warn); } .log-active::before { content:"run"; }
    .log-success { color:var(--ok); } .log-success::before { content:"ok"; }
    .log-error { color:var(--danger); } .log-error::before { content:"error"; }
    @media (max-width:640px) { body{padding:14px;place-items:start center;} header,.head,section,.actions,.log-panel{padding-left:20px;padding-right:20px;} .actions{flex-direction:column;} .right-actions{flex-direction:column-reverse;} button{width:100%;} }
  </style>
</head>
<body>
  <main>
    <header>
      <div class="brand">${LEADBAY_LOGO_SVG}<span>Leadbay</span></div>
      <span class="badge">MCP · v${VERSION}</span>
    </header>
    <div class="steps"><div class="dot active" id="dot-1"></div><div class="dot" id="dot-2"></div></div>
    <div class="head"><h1 id="title">Remove Leadbay MCP</h1><div class="meta" id="meta">${formatInstallOsLabel()}</div></div>

    <section id="step-1"><p class="lead">Select the agents to remove Leadbay MCP from.</p><div class="agents" id="agents"></div></section>
    <section id="step-2" class="hidden"><p class="lead">Removing…</p><div class="hint">Keep this window open until it's done.</div></section>

    <div class="actions"><button id="back" class="ghost hidden">Back</button><div class="right-actions"><button id="refresh">Refresh</button><button class="danger" id="next">Remove selected</button></div></div>
    <div id="log" class="log-panel"><div class="log-row log-info">Ready.</div></div>
  </main>
  <script>
    const $ = (id) => document.getElementById(id);
    const TITLES = { 1: "Remove Leadbay MCP", 2: "Removing" };
    let step = 1;
    let clients = [];
    function clearLog() { $("log").innerHTML = ""; }
    function appendLog(level, text) { const row = document.createElement("div"); row.className = "log-row log-" + level; row.textContent = text; $("log").appendChild(row); $("log").scrollTop = $("log").scrollHeight; }
    function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
    function setStep(n) { step = n; [1,2].forEach((i) => { $("step-" + i).classList.toggle("hidden", i !== step); const dot = $("dot-" + i); dot.classList.toggle("active", i === step); dot.classList.toggle("done", i < step); }); $("title").textContent = TITLES[step]; $("next").classList.toggle("hidden", step === 2); $("refresh").classList.toggle("hidden", step === 2); }
    function renderAgents() { const root = $("agents"); if (!clients.length) { root.innerHTML = '<div class="hint">No Leadbay MCP installation detected on this machine.</div>'; return; } root.innerHTML = clients.map((c) => '<label class="agent"><input type="checkbox" data-client="' + esc(c.id) + '" checked /><span><strong>' + esc(c.label) + '</strong><span class="detail">' + esc(c.detail) + '</span></span></label>').join(""); }
    async function refresh() { clearLog(); appendLog("info", "Detecting agents..."); const res = await fetch("/api/status"); const data = await res.json(); clients = (data.clients || []).filter((c) => c.configured); renderAgents(); appendLog("info", clients.length ? "Agents detected." : "No Leadbay MCP installation detected on this machine."); }
    async function doUninstall() { const selected = [...document.querySelectorAll("[data-client]:checked")].map((el) => el.dataset.client); if (!selected.length) { clearLog(); appendLog("error", "Select at least one agent."); return; } setStep(2); clearLog(); appendLog("info", "Starting removal..."); const params = new URLSearchParams({ clients: selected.join(",") }); const events = new EventSource("/api/uninstall-stream?" + params.toString()); events.onmessage = (event) => { const data = JSON.parse(event.data); appendLog(data.level === "done" ? "success" : data.level, data.message); if (data.level === "done") events.close(); }; events.onerror = () => { appendLog("error", "Uninstall stream disconnected."); events.close(); }; }
    $("back").addEventListener("click", () => setStep(1));
    $("refresh").addEventListener("click", refresh);
    $("next").addEventListener("click", doUninstall);
    refresh();
  </script>
</body>
</html>`;
}

function pageHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Leadbay MCP installer</title>
  <style>
    :root { color-scheme: light dark; --bg:#fff; --panel:#fff; --ink:#0d0f0e; --text:#0d0f0e; --muted:#7b837e; --line:#e7eae8; --soft:#f6f7f5; --danger:#b42318; --ok:#0e9f6e; --warn:#b06a00; --shadow:0 24px 60px rgba(13,15,14,.10); }
    @media (prefers-color-scheme: dark) { :root { --bg:#0c0e0d; --panel:#141716; --ink:#fff; --text:#f2f5f3; --muted:#9aa39d; --line:#262b28; --soft:#1a1e1c; --shadow:0 24px 60px rgba(0,0,0,.4); } }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100vh; background:var(--bg); color:var(--text); font:15px/1.5 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif; display:grid; place-items:center; padding:32px; -webkit-font-smoothing:antialiased; }
    /* signature Leadbay gradient-glow wrapper */
    .glow { position:relative; width:min(720px,100%); border-radius:22px; }
    .glow::before { content:""; position:absolute; inset:-2px; border-radius:24px; padding:2px; background:linear-gradient(120deg,#8ab4ff,#7be0c3,#ffc2e0,#cdb4ff); -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0); -webkit-mask-composite:xor; mask-composite:exclude; opacity:.9; }
    .glow::after { content:""; position:absolute; inset:-14px; border-radius:30px; background:linear-gradient(120deg,#8ab4ff,#7be0c3,#ffc2e0,#cdb4ff); filter:blur(28px); opacity:.28; z-index:-1; }
    main { position:relative; background:var(--panel); border-radius:22px; box-shadow:var(--shadow); overflow:hidden; }
    header { padding:26px 30px 0; display:flex; align-items:center; justify-content:space-between; gap:16px; }
    .brand { display:flex; align-items:center; gap:10px; font-weight:800; font-size:18px; letter-spacing:-.01em; color:var(--ink); }
    .brand svg { display:block; }
    .badge { font-size:12px; font-weight:700; color:var(--muted); border:1px solid var(--line); border-radius:999px; padding:4px 11px; white-space:nowrap; }
    .head { padding:22px 30px 4px; }
    h1 { font-size:27px; line-height:1.1; margin:0 0 6px; letter-spacing:-.02em; font-weight:800; color:var(--ink); }
    .meta,.hint,.detail { color:var(--muted); }
    .meta { font-size:13px; }
    /* slim step dots */
    .steps { display:flex; gap:8px; padding:14px 30px 0; }
    .dot { flex:1; height:4px; border-radius:999px; background:var(--line); transition:background .2s; }
    .dot.active,.dot.done { background:var(--ink); }
    section { padding:18px 30px 6px; }
    .hidden { display:none; }
    .lead { font-size:16px; font-weight:650; color:var(--ink); margin:0 0 2px; }
    .agents { display:grid; gap:10px; margin-top:14px; }
    .agent { display:grid; grid-template-columns:auto 1fr; gap:12px; align-items:center; padding:14px 16px; border:1px solid var(--line); border-radius:14px; cursor:pointer; transition:border-color .15s,background .15s; }
    .agent:hover { border-color:var(--ink); }
    .agent strong { display:block; font-weight:700; color:var(--ink); }
    .agent .detail { font-size:12.5px; word-break:break-all; }
    .agent input { width:18px; height:18px; accent-color:var(--ink); }
    .opts { display:flex; gap:20px; flex-wrap:wrap; margin-top:16px; }
    .toggle { display:inline-flex; align-items:center; gap:8px; font-weight:600; color:var(--text); cursor:pointer; }
    .toggle input { width:16px; height:16px; accent-color:var(--ink); }
    .badge-pill { font-size:10px; font-weight:800; padding:2px 7px; border-radius:999px; vertical-align:middle; text-transform:uppercase; letter-spacing:.03em; }
    .badge-install { background:color-mix(in srgb,var(--ok),transparent 86%); color:var(--ok); }
    .badge-update { background:color-mix(in srgb,var(--warn),transparent 84%); color:var(--warn); }
    .actions { display:flex; justify-content:space-between; gap:10px; padding:16px 30px 22px; }
    .right-actions { display:flex; gap:10px; }
    button { min-height:44px; border-radius:999px; border:1px solid var(--line); background:transparent; color:var(--text); padding:10px 20px; font:inherit; font-weight:700; cursor:pointer; transition:opacity .15s,transform .05s; }
    button:active { transform:translateY(1px); }
    button.primary { background:var(--ink); border-color:var(--ink); color:var(--bg); padding:10px 26px; }
    button.primary:hover { opacity:.88; }
    button.ghost { border-color:transparent; color:var(--muted); }
    button:disabled { opacity:.45; cursor:default; }
    .log-panel { margin:0; background:var(--soft); border-top:1px solid var(--line); padding:14px 30px; min-height:64px; max-height:240px; overflow:auto; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:12.5px; }
    .log-row { display:flex; gap:10px; align-items:flex-start; padding:3px 0; white-space:pre-wrap; word-break:break-word; }
    .log-row::before { width:48px; flex:0 0 48px; font-weight:800; text-transform:uppercase; font-size:10px; letter-spacing:.04em; opacity:.8; }
    .log-info { color:var(--muted); } .log-info::before { content:"info"; }
    .log-active { color:var(--warn); } .log-active::before { content:"run"; }
    .log-success { color:var(--ok); } .log-success::before { content:"ok"; }
    .log-error { color:var(--danger); } .log-error::before { content:"error"; }
    @media (max-width:640px) { body{padding:14px;place-items:start center;} header,.head,section,.actions,.log-panel{padding-left:20px;padding-right:20px;} .actions{flex-direction:column;} .right-actions{flex-direction:column-reverse;} button{width:100%;} }
  </style>
</head>
<body>
  <div class="glow"><main>
    <header>
      <div class="brand">${LEADBAY_LOGO_SVG}<span>Leadbay</span></div>
      <span class="badge">MCP · v${VERSION}</span>
    </header>
    <div class="steps"><div class="dot active" id="dot-1"></div><div class="dot" id="dot-2"></div><div class="dot" id="dot-3"></div></div>
    <div class="head"><h1 id="title">Connect Leadbay</h1><div class="meta" id="meta">${formatInstallOsLabel()}</div></div>

    <section id="step-1"><p class="lead">Sign in to install Leadbay across your AI agents.</p></section>
    <section id="step-2" class="hidden">
      <p class="lead">Choose where to install</p>
      <div class="agents" id="agents"></div>
      <div class="opts">
        <label class="toggle"><input id="write" type="checkbox" checked /> Write tools</label>
        <label class="toggle"><input id="telemetry" type="checkbox" checked /> Telemetry</label>
      </div>
    </section>
    <section id="step-3" class="hidden"><p class="lead">Installing…</p><div class="hint">Keep this window open until it's done.</div></section>

    <div class="actions"><button id="back" class="ghost hidden">Back</button><div class="right-actions"><button id="refresh" class="hidden">Refresh</button><button class="primary" id="next">Sign in with Leadbay</button></div></div>
    <div id="log" class="log-panel"><div class="log-row log-info">Ready.</div></div>
  </main></div>
  <script>
    const $ = (id) => document.getElementById(id);
    const TITLES = { 1: "Connect Leadbay", 2: "Choose your agents", 3: "Installing" };
    let step = 1;
    let sessionId = null;
    let clients = [];
    function clearLog() { $("log").innerHTML = ""; }
    function appendLog(level, text) { const row = document.createElement("div"); row.className = "log-row log-" + level; row.textContent = text; $("log").appendChild(row); $("log").scrollTop = $("log").scrollHeight; }
    function line(text, error = false) { clearLog(); appendLog(error ? "error" : "info", text); }
    function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
    function setStep(next) {
      step = next;
      [1,2,3].forEach((n) => {
        $("step-" + n).classList.toggle("hidden", n !== step);
        const dot = $("dot-" + n); dot.classList.toggle("active", n === step); dot.classList.toggle("done", n < step);
      });
      $("title").textContent = TITLES[step];
      $("back").classList.toggle("hidden", step !== 2);
      $("refresh").classList.toggle("hidden", step !== 2);
      $("next").classList.toggle("hidden", step === 3);
      $("next").textContent = step === 2 ? "Install" : "Sign in with Leadbay";
    }
    function renderAgents() { const root = $("agents"); if (!clients.length) { root.innerHTML = '<div class="hint">No supported MCP client detected on this machine.</div>'; return; } root.innerHTML = clients.map((client) => { const manual = client.id === "chatgpt-desktop"; const badgeText = manual ? "manual" : client.configured ? "update" : "install"; const badgeClass = manual ? "badge-update" : client.configured ? "badge-update" : "badge-install"; return '<label class="agent"><input type="checkbox" data-client="' + esc(client.id) + '" checked /><span><strong>' + esc(client.label) + ' <span class="badge-pill ' + badgeClass + '">' + badgeText + '</span></strong><span class="detail">' + esc(client.detail) + '</span></span></label>'; }).join(""); }
    async function refresh() { line("Detecting agents..."); const res = await fetch("/api/status"); const data = await res.json(); clients = data.clients || []; renderAgents(); line(clients.length ? "Agents detected." : "No supported agents detected."); }
    async function doLogin() { $("next").disabled = true; line("Opening Leadbay sign-in in your browser..."); try { const res = await fetch("/api/oauth-login", { method:"POST" }); const data = await res.json(); if (!data.ok) return line(data.error || "OAuth login failed.", true); sessionId = data.sessionId; line("Signed in. Detecting installed agents..."); setStep(2); await refresh(); } finally { $("next").disabled = false; } }
    async function install() { const selected = [...document.querySelectorAll("[data-client]:checked")].map((el) => el.dataset.client); if (!selected.length) return line("Select at least one agent.", true); setStep(3); clearLog(); appendLog("info", "Starting install..."); const params = new URLSearchParams({ sessionId, clients: selected.join(","), write: $("write").checked ? "1" : "0", telemetry: $("telemetry").checked ? "1" : "0" }); const events = new EventSource("/api/install-stream?" + params.toString()); events.onmessage = (event) => { const data = JSON.parse(event.data); appendLog(data.level === "done" ? "success" : data.level, data.message); if (data.level === "done") events.close(); }; events.onerror = () => { appendLog("error", "Install log stream disconnected."); events.close(); }; }
    $("back").addEventListener("click", () => setStep(1));
    $("refresh").addEventListener("click", refresh);
    $("next").addEventListener("click", async () => { if (step === 1) await doLogin(); else await install(); });
  </script>
</body>
</html>`;
}

async function openBrowser(url: string): Promise<void> {
  const { spawn } = await import("node:child_process");

  // Returns true only if the process exits 0. On Linux, xdg-open and friends
  // may be installed but exit non-zero when they cannot find a browser or
  // display — treating those as failures lets the loop fall through to the
  // next candidate and ultimately print the manual URL hint.
  const trySpawn = (command: string, args: string[]): Promise<boolean> =>
    new Promise((resolve) => {
      try {
        const child = spawn(command, args, { stdio: "ignore", detached: true });
        child.unref();
        child.on("error", () => resolve(false));
        child.on("close", (code) => resolve(code === 0));
      } catch {
        resolve(false);
      }
    });

  if (process.platform === "darwin") {
    await trySpawn("open", [url]);
    return;
  }

  if (process.platform === "win32") {
    await trySpawn("cmd", ["/c", "start", "", url]);
    return;
  }

  // Linux: try candidates in order.
  const candidates = ["xdg-open", "sensible-browser", "google-chrome", "chromium-browser", "firefox"];
  for (const cmd of candidates) {
    if (await trySpawn(cmd, [url])) return;
  }

  // Nothing worked — print a prominent hint so the user knows what to do.
  process.stderr.write(`\n  Open this URL in your browser to continue:\n  ${url}\n\n`);
}

function makeGuiServer(
  options: InstallerGuiOptions,
  pageContent: () => string,
  extraRoutes: (req: import("node:http").IncomingMessage, res: ServerResponse, onDone: () => void) => Promise<boolean>,
  logLabel: string
): Promise<InstallerGuiHandle> {
  let expectedHost = `127.0.0.1:${(options.port ?? PORT) || 0}`;
  let resolveDone!: () => void;
  const done = new Promise<void>((r) => { resolveDone = r; });
  // Give the browser 1.5 s to render the final message before we kill the server.
  const onDone = () => setTimeout(() => { resolveDone(); }, 1500);

  const server = createServer(async (req, res) => {
    if (!isAllowedOrigin(req, expectedHost)) { sendJson(res, 403, { ok: false, error: "forbidden" }); return; }
    try {
      if (req.method === "GET" && req.url === "/") {
        const raw = pageContent();
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": Buffer.byteLength(raw) });
        res.end(raw);
        return;
      }
      if (await extraRoutes(req, res, onDone)) return;
      sendJson(res, 404, { ok: false, error: "not found" });
    } catch (err: any) {
      sendJson(res, 500, { ok: false, error: err?.message ?? String(err) });
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? PORT, "127.0.0.1", async () => {
      server.off("error", reject);
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : options.port ?? PORT;
      expectedHost = `127.0.0.1:${port}`;
      const url = `http://127.0.0.1:${port}/`;
      process.stderr.write(`Leadbay MCP ${logLabel} GUI: ${url}\n`);
      if (options.openBrowser !== false) await openBrowser(url).catch(() => undefined);
      resolve({ url, done, close: () => new Promise((res, rej) => server.close((e) => e ? rej(e) : res())) });
    });
  });
}

export function startInstallerGui(options: InstallerGuiOptions = {}): Promise<InstallerGuiHandle> {
  return makeGuiServer(options, pageHtml, async (req, res, onDone) => {
    if (req.method === "GET" && req.url === "/api/status") {
      sendJson(res, 200, { os: formatInstallOsLabel(), hostedMcpUrl: HOSTED_MCP_URL, clients: await clientsWithConfiguredStatus() });
      return true;
    }
    if (req.method === "POST" && req.url === "/api/oauth-login") { sendJson(res, 200, await loginWithOAuth()); return true; }
    if (req.method === "POST" && req.url === "/api/install") { sendJson(res, 200, await install((await readJson(req)) as InstallRequest)); return true; }
    if (req.method === "GET" && req.url?.startsWith("/api/install-stream")) {
      await streamInstall(new URL(req.url, "http://127.0.0.1"), res, onDone);
      return true;
    }
    return false;
  }, "installer");
}

export function startUninstallerGui(options: InstallerGuiOptions = {}): Promise<InstallerGuiHandle> {
  return makeGuiServer(options, pageUninstallHtml, async (req, res, onDone) => {
    if (req.method === "GET" && req.url === "/api/status") {
      sendJson(res, 200, { os: formatInstallOsLabel(), clients: await clientsWithConfiguredStatus() });
      return true;
    }
    if (req.method === "GET" && req.url?.startsWith("/api/uninstall-stream")) {
      await streamUninstall(new URL(req.url, "http://127.0.0.1"), res, onDone);
      return true;
    }
    return false;
  }, "uninstaller");
}

