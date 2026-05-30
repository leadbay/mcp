import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
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
export type InstallerGuiHandle = { url: string; close: () => Promise<void> };

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

async function installInto(client: DetectedClient, session: LoginSession, includeWrite: boolean, telemetryEnabled: boolean): Promise<InstallResult> {
  let res: { ok: boolean; message: string };
  if (client.id === "claude-code") {
    res = await installInClaudeCode(session.token, session.region, includeWrite, telemetryEnabled);
  } else if (client.id === "codex") {
    const configRes = await installInCodexConfig(client.configPath ?? client.detail, includeWrite, telemetryEnabled);
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
    const jsonResult = await installInJsonConfig(client.configPath!, session.token, session.region, includeWrite, telemetryEnabled);
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
    res = await installInJsonConfig(client.configPath!, session.token, session.region, includeWrite, telemetryEnabled);
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

async function streamInstall(url: URL, res: ServerResponse): Promise<void> {
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

  if (!session) {
    emit("error", "Login expired. Go back and sign in again.");
    emit("done", "Install stopped.");
    res.end();
    return;
  }
  if (!clientIds.length) {
    emit("error", "Select at least one agent.");
    emit("done", "Install stopped.");
    res.end();
    return;
  }

  emit("info", `Connected to ${session.accountLabel}.`);
  emit("info", `Write tools ${includeWrite ? "enabled" : "disabled"}; telemetry ${telemetryEnabled ? "enabled" : "disabled"}.`);
  emit("info", "Refreshing installed-agent detection...");

  const detected = await detectClients();
  const selected = detected.filter((client) => clientIds.includes(client.id));
  const selectedHasOnlyManualSetup = selected.length > 0 && selected.every(isManualSetupClient);
  if (!selected.length) {
    emit("error", "No selected agents were detected on this machine.");
    emit("done", "Install stopped.");
    res.end();
    return;
  }

  let okCount = 0;
  for (const client of selected) {
    emit("active", isManualSetupClient(client) ? `Preparing ${client.label} manual setup...` : `Installing ${client.label}...`);
    const result = await installInto(client, session, includeWrite, telemetryEnabled);
    if (result.ok) {
      okCount += 1;
      emit("success", `${result.label}: ${result.message}`);
    } else {
      emit("error", `${result.label}: ${result.message}`);
    }
  }

  emit(okCount > 0 ? "success" : "error", selectedHasOnlyManualSetup ? "Manual ChatGPT setup instructions ready." : `${okCount}/${selected.length} agent(s) installed, updated, or prepared.`);
  emit("done", selectedHasOnlyManualSetup ? "Follow the manual setup instructions shown above." : "Restart your MCP client(s) to pick up the new server.");
  res.end();
}

async function streamUninstall(url: URL, res: ServerResponse): Promise<void> {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });

  const clientIds = (url.searchParams.get("clients") ?? "").split(",").filter(Boolean);
  const emit = (level: LogLevel, message: string) => sendSse(res, { level, message });

  if (!clientIds.length) {
    emit("error", "Select at least one agent.");
    emit("done", "Uninstall stopped.");
    res.end();
    return;
  }

  const detected = await detectClients();
  const selected = detected.filter((c) => clientIds.includes(c.id));
  if (!selected.length) {
    emit("error", "No selected agents were detected on this machine.");
    emit("done", "Uninstall stopped.");
    res.end();
    return;
  }

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
    if (res2.ok) {
      okCount += 1;
      emit("success", `${client.label}: ${res2.message}`);
    } else {
      emit("error", `${client.label}: ${res2.message}`);
    }
  }

  emit(okCount > 0 ? "success" : "error", `${okCount}/${selected.length} agent(s) removed.`);
  emit("done", "Restart your MCP client(s) to complete the removal.");
  res.end();
}

function pageUninstallHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Leadbay MCP uninstaller</title>
  <style>
    :root { color-scheme: light dark; --bg:#f6f7f4; --panel:#fff; --text:#1d241f; --muted:#65706a; --line:#dbe2dc; --accent:#008f7a; --accent2:#06705f; --danger:#b42318; --shadow:0 18px 45px rgba(32,45,38,.12); }
    @media (prefers-color-scheme: dark) { :root { --bg:#121612; --panel:#1b211c; --text:#eef4ed; --muted:#a4afa7; --line:#303930; --shadow:0 18px 45px rgba(0,0,0,.28); } }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100vh; background:var(--bg); color:var(--text); font:14px/1.45 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; display:grid; place-items:center; padding:28px; }
    main { width:min(880px,100%); background:var(--panel); border:1px solid var(--line); border-radius:8px; box-shadow:var(--shadow); overflow:hidden; }
    header { padding:22px 24px 16px; border-bottom:1px solid var(--line); display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
    h1 { font-size:22px; line-height:1.15; margin:0 0 6px; letter-spacing:0; }
    .meta { color:var(--muted); }
    .badge { border:1px solid var(--line); border-radius:999px; padding:5px 10px; color:var(--muted); white-space:nowrap; }
    .steps { display:grid; grid-template-columns:repeat(2,1fr); border-bottom:1px solid var(--line); }
    .step-pill { padding:12px 24px; border-right:1px solid var(--line); color:var(--muted); font-weight:700; }
    .step-pill:last-child { border-right:0; }
    .step-pill.active { color:var(--text); background:color-mix(in srgb,var(--danger),transparent 88%); }
    section { padding:22px 24px; }
    .hidden { display:none; }
    .hint,.detail { color:var(--muted); }
    .agents { display:grid; gap:8px; margin-top:12px; }
    .agent { display:grid; grid-template-columns:auto 1fr; gap:12px; align-items:center; padding:12px; border:1px solid var(--line); border-radius:6px; }
    .agent strong { display:block; }
    .agent input { width:18px; min-height:18px; }
    .actions { display:flex; justify-content:space-between; gap:10px; border-top:1px solid var(--line); padding:16px 24px 20px; }
    .right-actions { display:flex; gap:10px; }
    button { min-height:40px; border-radius:6px; border:1px solid var(--line); background:transparent; color:var(--text); padding:8px 14px; font:inherit; font-weight:700; cursor:pointer; }
    button.danger { background:var(--danger); border-color:var(--danger); color:#fff; }
    button:disabled { opacity:.6; cursor:wait; }
    .log-panel { margin:0; background:color-mix(in srgb,var(--panel),#000 7%); border-top:1px solid var(--line); padding:16px 24px; min-height:76px; max-height:280px; overflow:auto; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:13px; }
    .log-row { display:flex; gap:10px; align-items:flex-start; padding:3px 0; white-space:pre-wrap; word-break:break-word; }
    .log-row::before { width:56px; flex:0 0 56px; font-weight:800; text-transform:uppercase; font-size:11px; letter-spacing:.02em; }
    .log-info { color:var(--muted); } .log-info::before { content:"info"; }
    .log-active { color:#c99700; } .log-active::before { content:"run"; }
    .log-success { color:#19a974; } .log-success::before { content:"ok"; }
    .log-error { color:var(--danger); } .log-error::before { content:"error"; }
    .badge-configured { font-size:10px; font-weight:800; padding:2px 6px; border-radius:999px; vertical-align:middle; background:color-mix(in srgb,var(--danger),transparent 80%); color:var(--danger); }
    .badge-absent { font-size:10px; font-weight:800; padding:2px 6px; border-radius:999px; vertical-align:middle; background:color-mix(in srgb,var(--muted),transparent 80%); color:var(--muted); }
    @media (max-width:680px) { body{padding:12px;place-items:start center;} header{display:block;} .badge{display:inline-block;margin-top:12px;} .steps{grid-template-columns:1fr;} .step-pill{border-right:0;border-bottom:1px solid var(--line);} .actions{display:grid;} .right-actions{display:grid;} }
  </style>
</head>
<body>
  <main>
    <header><div><h1>Leadbay MCP uninstaller</h1><div class="meta" id="meta">${formatInstallOsLabel()}</div></div><div class="badge">v${VERSION}</div></header>
    <div class="steps"><div class="step-pill active" id="pill-1">1. Select agents</div><div class="step-pill" id="pill-2">2. Remove</div></div>

    <section id="step-1"><strong>Detected agents</strong><div class="hint">Select which agents to remove Leadbay MCP from.</div><div class="agents" id="agents"></div></section>
    <section id="step-2" class="hidden"><strong>Removing</strong><div class="hint">Keep this window open until the final message appears.</div></section>

    <div class="actions"><button id="back" disabled>Back</button><div class="right-actions"><button id="refresh">Refresh</button><button class="danger" id="next">Remove selected</button></div></div>
    <div id="log" class="log-panel"><div class="log-row log-info">Ready.</div></div>
  </main>
  <script>
    const $ = (id) => document.getElementById(id);
    let step = 1;
    let clients = [];
    function clearLog() { $("log").innerHTML = ""; }
    function appendLog(level, text) { const row = document.createElement("div"); row.className = "log-row log-" + level; row.textContent = text; $("log").appendChild(row); $("log").scrollTop = $("log").scrollHeight; }
    function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
    function setStep(n) { step = n; [1,2].forEach((i) => { $("step-" + i).classList.toggle("hidden", i !== step); $("pill-" + i).classList.toggle("active", i === step); }); $("back").disabled = step === 1 || step === 2; $("next").classList.toggle("hidden", step === 2); $("refresh").classList.toggle("hidden", step === 2); }
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
    :root { color-scheme: light dark; --bg:#f6f7f4; --panel:#fff; --text:#1d241f; --muted:#65706a; --line:#dbe2dc; --accent:#008f7a; --accent2:#06705f; --danger:#b42318; --shadow:0 18px 45px rgba(32,45,38,.12); }
    @media (prefers-color-scheme: dark) { :root { --bg:#121612; --panel:#1b211c; --text:#eef4ed; --muted:#a4afa7; --line:#303930; --shadow:0 18px 45px rgba(0,0,0,.28); } }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100vh; background:var(--bg); color:var(--text); font:14px/1.45 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; display:grid; place-items:center; padding:28px; }
    main { width:min(880px,100%); background:var(--panel); border:1px solid var(--line); border-radius:8px; box-shadow:var(--shadow); overflow:hidden; }
    header { padding:22px 24px 16px; border-bottom:1px solid var(--line); display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
    h1 { font-size:22px; line-height:1.15; margin:0 0 6px; letter-spacing:0; }
    .meta,.hint,.detail,label span { color:var(--muted); }
    .badge { border:1px solid var(--line); border-radius:999px; padding:5px 10px; color:var(--muted); white-space:nowrap; }
    .steps { display:grid; grid-template-columns:repeat(4,1fr); border-bottom:1px solid var(--line); }
    .step-pill { padding:12px 24px; border-right:1px solid var(--line); color:var(--muted); font-weight:700; }
    .step-pill:last-child { border-right:0; }
    .step-pill.active { color:var(--text); background:color-mix(in srgb,var(--accent),transparent 88%); }
    section { padding:22px 24px; }
    .hidden { display:none; }
    .grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; }
    label { display:grid; gap:6px; font-weight:650; }
    input,select { width:100%; min-height:40px; border:1px solid var(--line); border-radius:6px; background:transparent; color:var(--text); padding:8px 10px; font:inherit; }
    .options { display:flex; gap:14px; flex-wrap:wrap; margin-top:14px; }
    .toggle { display:inline-flex; align-items:center; gap:8px; font-weight:600; }
    .toggle input { width:16px; min-height:16px; }
    .setting-card { display:grid; gap:4px; max-width:360px; }
    .setting-card .hint { padding-left:24px; }
    .agents { display:grid; gap:8px; margin-top:12px; }
    .agent { display:grid; grid-template-columns:auto 1fr; gap:12px; align-items:center; padding:12px; border:1px solid var(--line); border-radius:6px; }
    .agent strong { display:block; }
    .agent input { width:18px; min-height:18px; }
    .actions { display:flex; justify-content:space-between; gap:10px; border-top:1px solid var(--line); padding:16px 24px 20px; }
    .right-actions { display:flex; gap:10px; }
    button { min-height:40px; border-radius:6px; border:1px solid var(--line); background:transparent; color:var(--text); padding:8px 14px; font:inherit; font-weight:700; cursor:pointer; }
    button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
    button.primary:hover { background:var(--accent2); }
    button:disabled { opacity:.6; cursor:wait; }
    .log-panel { margin:0; background:color-mix(in srgb,var(--panel),#000 7%); border-top:1px solid var(--line); padding:16px 24px; min-height:76px; max-height:280px; overflow:auto; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:13px; }
    .log-row { display:flex; gap:10px; align-items:flex-start; padding:3px 0; white-space:pre-wrap; word-break:break-word; }
    .log-row::before { width:56px; flex:0 0 56px; font-weight:800; text-transform:uppercase; font-size:11px; letter-spacing:.02em; }
    .log-info { color:var(--muted); }
    .log-info::before { content:"info"; }
    .log-active { color:#c99700; }
    .log-active::before { content:"run"; }
    .log-success { color:#19a974; }
    .log-success::before { content:"ok"; }
    .log-error { color:var(--danger); }
    .log-error::before { content:"error"; }
    .error { color:var(--danger); }
    .badge-install,.badge-update { font-size:10px; font-weight:800; padding:2px 6px; border-radius:999px; vertical-align:middle; }
    .badge-install { background:color-mix(in srgb,var(--accent),transparent 80%); color:var(--accent2); }
    .badge-update { background:color-mix(in srgb,#c99700,transparent 80%); color:#a07800; }
    @media (prefers-color-scheme: dark) { .badge-update { color:#f0c040; } .badge-install { color:#00c9a0; } }
    @media (max-width:680px) { body{padding:12px;place-items:start center;} header{display:block;} .badge{display:inline-block;margin-top:12px;} .grid,.steps{grid-template-columns:1fr;} .step-pill{border-right:0;border-bottom:1px solid var(--line);} .actions{display:grid;} .right-actions{display:grid;} }
  </style>
</head>
<body>
  <main>
    <header><div><h1>Leadbay MCP installer</h1><div class="meta" id="meta">${formatInstallOsLabel()}</div></div><div class="badge">v${VERSION}</div></header>
    <div class="steps"><div class="step-pill active" id="pill-1">1. Sign in</div><div class="step-pill" id="pill-2">2. Agents</div><div class="step-pill" id="pill-3">3. Install</div></div>

    <section id="step-1"><strong>Connect your Leadbay account</strong><div class="hint">This opens Leadbay in your browser. After approval, come back here to choose where to install the MCP.</div></section>
    <section id="step-2" class="hidden"><strong>Detected agents</strong><div class="hint">Local agents are installed automatically when supported. ChatGPT Desktop requires manual setup with the hosted MCP URL.</div><div class="agents" id="agents"></div><div class="options"><div class="setting-card"><label class="toggle"><input id="write" type="checkbox" checked /> Write tools</label><div class="hint">Allows Leadbay actions that change data or spend credits, like import, enrich, qualify, refine audience, and log outreach.</div></div><div class="setting-card"><label class="toggle"><input id="telemetry" type="checkbox" checked /> Telemetry</label><div class="hint">Sends product usage and crash events so we can debug installs. It does not send tool arguments, lead data, or the token.</div></div></div></section>
    <section id="step-3" class="hidden"><strong>Installing</strong><div class="hint">Keep this window open until the final message appears. ChatGPT Desktop setup is manual in ChatGPT Settings > Apps.</div></section>

    <div class="actions"><button id="back" disabled>Back</button><div class="right-actions"><button id="refresh" class="hidden">Refresh</button><button class="primary" id="next">Sign in with Leadbay</button></div></div>
    <div id="log" class="log-panel"><div class="log-row log-info">Ready.</div></div>
  </main>
  <script>
    const $ = (id) => document.getElementById(id);
    let step = 1;
    let sessionId = null;
    let clients = [];
    function clearLog() { $("log").innerHTML = ""; }
    function appendLog(level, text) { const row = document.createElement("div"); row.className = "log-row log-" + level; row.textContent = text; $("log").appendChild(row); $("log").scrollTop = $("log").scrollHeight; }
    function line(text, error = false) { clearLog(); appendLog(error ? "error" : "info", text); }
    function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
    function setStep(next) { step = next; [1,2,3].forEach((n) => { $("step-" + n).classList.toggle("hidden", n !== step); $("pill-" + n).classList.toggle("active", n === step); }); $("back").disabled = step === 1 || step === 3; $("refresh").classList.toggle("hidden", step !== 2); $("next").classList.toggle("hidden", step === 3); $("next").textContent = step === 2 ? "Continue" : "Sign in with Leadbay"; }
    function renderAgents() { const root = $("agents"); if (!clients.length) { root.innerHTML = '<div class="hint">No supported MCP client detected on this machine.</div>'; return; } root.innerHTML = clients.map((client) => { const manual = client.id === "chatgpt-desktop"; const badgeText = manual ? "manual setup" : client.configured ? "update" : "install"; const badgeClass = manual ? "badge-update" : client.configured ? "badge-update" : "badge-install"; return '<label class="agent"><input type="checkbox" data-client="' + esc(client.id) + '" checked /><span><strong>' + esc(client.label) + ' <span class="' + badgeClass + '">' + badgeText + '</span></strong><span class="detail">' + esc(client.detail) + '</span></span></label>'; }).join(""); }
    async function refresh() { line("Detecting agents..."); const res = await fetch("/api/status"); const data = await res.json(); clients = data.clients || []; renderAgents(); line(clients.length ? "Agents detected." : "No supported agents detected."); }
    async function doLogin() { $("next").disabled = true; line("Opening Leadbay sign-in in your browser..."); try { const res = await fetch("/api/oauth-login", { method:"POST" }); const data = await res.json(); if (!data.ok) return line(data.error || "OAuth login failed.", true); sessionId = data.sessionId; line("Signed in. Detecting installed agents..."); setStep(2); await refresh(); } finally { $("next").disabled = false; } }
    async function install() { const selected = [...document.querySelectorAll("[data-client]:checked")].map((el) => el.dataset.client); if (!selected.length) return line("Select at least one agent.", true); setStep(3); clearLog(); appendLog("info", "Starting install..."); const params = new URLSearchParams({ sessionId, clients: selected.join(","), write: $("write").checked ? "1" : "0", telemetry: $("telemetry").checked ? "1" : "0" }); const events = new EventSource("/api/install-stream?" + params.toString()); events.onmessage = (event) => { const data = JSON.parse(event.data); appendLog(data.level === "done" ? "success" : data.level, data.message); if (data.level === "done") events.close(); }; events.onerror = () => { appendLog("error", "Install log stream disconnected."); events.close(); }; }
    $("back").addEventListener("click", () => setStep(Math.max(1, step - 1)));
    $("refresh").addEventListener("click", refresh);
    $("next").addEventListener("click", async () => { if (step === 1) await doLogin(); else await install(); });
  </script>
</body>
</html>`;
}

async function openBrowser(url: string): Promise<void> {
  const { spawn } = await import("node:child_process");
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { stdio: "ignore", detached: true });
  child.unref();
}

export async function startInstallerGui(options: InstallerGuiOptions = {}): Promise<InstallerGuiHandle> {
  let expectedHost = `127.0.0.1:${(options.port ?? PORT) || 0}`;

  const server = createServer(async (req, res) => {
    if (!isAllowedOrigin(req, expectedHost)) {
      sendJson(res, 403, { ok: false, error: "forbidden" });
      return;
    }
    try {
      if (req.method === "GET" && req.url === "/") {
        const raw = pageHtml();
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": Buffer.byteLength(raw) });
        res.end(raw);
        return;
      }
      if (req.method === "GET" && req.url === "/api/status") {
        sendJson(res, 200, {
          os: formatInstallOsLabel(),
          hostedMcpUrl: HOSTED_MCP_URL,
          clients: await clientsWithConfiguredStatus(),
        });
        return;
      }
      if (req.method === "POST" && req.url === "/api/oauth-login") {
        sendJson(res, 200, await loginWithOAuth());
        return;
      }
      if (req.method === "POST" && req.url === "/api/install") {
        sendJson(res, 200, await install((await readJson(req)) as InstallRequest));
        return;
      }
      if (req.method === "GET" && req.url?.startsWith("/api/install-stream")) {
        await streamInstall(new URL(req.url, "http://127.0.0.1"), res);
        return;
      }
      sendJson(res, 404, { ok: false, error: "not found" });
    } catch (err: any) {
      sendJson(res, 500, { ok: false, error: err?.message ?? String(err) });
    }
  });

  return await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? PORT, "127.0.0.1", async () => {
      server.off("error", reject);
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : options.port ?? PORT;
      expectedHost = `127.0.0.1:${port}`;
      const url = `http://127.0.0.1:${port}/`;
      process.stderr.write(`Leadbay MCP installer GUI: ${url}\n`);
      if (options.openBrowser !== false) await openBrowser(url).catch(() => undefined);
      resolve({ url, close: () => new Promise((closeResolve, closeReject) => server.close((err) => (err ? closeReject(err) : closeResolve()))) });
    });
  });
}

export async function startUninstallerGui(options: InstallerGuiOptions = {}): Promise<InstallerGuiHandle> {
  let expectedHost = `127.0.0.1:${(options.port ?? PORT) || 0}`;

  const server = createServer(async (req, res) => {
    if (!isAllowedOrigin(req, expectedHost)) {
      sendJson(res, 403, { ok: false, error: "forbidden" });
      return;
    }
    try {
      if (req.method === "GET" && req.url === "/") {
        const raw = pageUninstallHtml();
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": Buffer.byteLength(raw) });
        res.end(raw);
        return;
      }
      if (req.method === "GET" && req.url === "/api/status") {
        sendJson(res, 200, {
          os: formatInstallOsLabel(),
          clients: await clientsWithConfiguredStatus(),
        });
        return;
      }
      if (req.method === "GET" && req.url?.startsWith("/api/uninstall-stream")) {
        await streamUninstall(new URL(req.url, "http://127.0.0.1"), res);
        return;
      }
      sendJson(res, 404, { ok: false, error: "not found" });
    } catch (err: any) {
      sendJson(res, 500, { ok: false, error: err?.message ?? String(err) });
    }
  });

  return await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? PORT, "127.0.0.1", async () => {
      server.off("error", reject);
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : options.port ?? PORT;
      expectedHost = `127.0.0.1:${port}`;
      const url = `http://127.0.0.1:${port}/`;
      process.stderr.write(`Leadbay MCP uninstaller GUI: ${url}\n`);
      if (options.openBrowser !== false) await openBrowser(url).catch(() => undefined);
      resolve({ url, close: () => new Promise((closeResolve, closeReject) => server.close((err) => (err ? closeReject(err) : closeResolve()))) });
    });
  });
}

async function main(): Promise<void> {
  const uninstall = process.argv.includes("--uninstall");
  const handle = uninstall
    ? await startUninstallerGui({ openBrowser: !process.argv.includes("--no-open") })
    : await startInstallerGui({ openBrowser: !process.argv.includes("--no-open") });

  // Keep the process alive until the user closes the browser tab or hits Ctrl+C.
  // Without this, Node exits immediately after main() returns and the HTTP
  // server dies before the browser can connect.
  await new Promise<void>((resolve) => {
    process.once("SIGINT", () => resolve());
    process.once("SIGTERM", () => resolve());
  });
  await handle.close().catch(() => undefined);
}

const isEntrypoint = (() => {
  try {
    const entry = process.argv[1];
    if (!entry) return false;
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry);
  } catch {
    return false;
  }
})();

if (isEntrypoint) {
  main().catch((err) => {
    process.stderr.write(`leadbay-mcp-installer: ${err?.message ?? err}\n`);
    process.exit(1);
  });
}
