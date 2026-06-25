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


// Replaced at build time by tsup with the package.json version string.
// Falls back to a dev sentinel when the global is undefined (raw ts-node runs).
declare const __LEADBAY_MCP_VERSION__: string;
const VERSION = typeof __LEADBAY_MCP_VERSION__ !== "undefined" ? __LEADBAY_MCP_VERSION__ : "0.0.0-dev";

// ────────────────────────────────────────────────────────────────────────────
// Localization (EN/FR)
//
// The installer auto-detects the user's region via GeoIP (inferRegionViaStargate).
// We localize the whole UI to that region: French for `fr`, English for `us`.
// The locale is purely cosmetic — the authoritative region for backend selection
// is still the one loginWithOAuth computes and stores on the session. A VPN/travel
// divergence only changes language, never which backend installs.

type Locale = "en" | "fr";

// String-only sub-dictionaries (installer/uninstaller) are JSON-injected into the
// page so the inline client script can read them. The `server` sub-dictionary has
// param-taking functions and stays server-side (SSE + summary builder).
type InstallerStrings = {
  docTitle: string;
  steps: { 1: { title: string; sub: string }; 2: { title: string; sub: string }; 3: { title: string; sub: string } };
  btnSignIn: string;
  btnInstall: string;
  btnBack: string;
  btnRefresh: string;
  noClientsDetected: string;
  noAgentsDetected: string;
  selectAtLeastOne: string;
  openingSignIn: string;
  oauthFailed: string;
  successInstalled: string;
  noneInstalled: string;
  streamDisconnected: string;
  closeWindow: string;
  allSet: string;
  somethingWrong: string;
  badgeManual: string;
  badgeUpdate: string;
  badgeInstall: string;
};

type UninstallerStrings = {
  docTitle: string;
  steps: { 1: { title: string; sub: string }; 2: { title: string; sub: string } };
  btnRemove: string;
  btnBack: string;
  btnRefresh: string;
  noInstallDetected: string;
  selectAtLeastOne: string;
  successRemoved: string;
  noneRemoved: string;
  streamDisconnected: string;
  closeWindow: string;
  allSet: string;
  somethingWrong: string;
};

type ServerStrings = {
  loginExpired: string;
  selectAtLeastOne: string;
  noSelectedDetected: string;
  installStopped: string;
  uninstallStopped: string;
  connectedTo: (label: string) => string;
  toolFlags: (write: boolean, telemetry: boolean) => string;
  refreshingDetection: string;
  installing: (label: string) => string;
  preparingManual: (label: string) => string;
  removing: (label: string) => string;
  installedSummary: (ok: number, total: number) => string;
  manualReady: string;
  removedSummary: (ok: number, total: number) => string;
  restartClients: string;
  followManual: string;
  completeRemoval: string;
  loggedInBackend: (region: string) => string;
  settingsLine: (write: boolean, telemetry: boolean) => string;
  installSummaryHeader: string;
  noAgentsRemoved: string;
};

type Strings = { installer: InstallerStrings; uninstaller: UninstallerStrings; server: ServerStrings };

const MESSAGES: Record<Locale, Strings> = {
  en: {
    installer: {
      docTitle: "Leadbay MCP installer",
      steps: {
        1: { title: "Connect Leadbay", sub: "Sign in to install Leadbay across your AI agents." },
        2: { title: "Choose your agents", sub: "Pick where to install Leadbay." },
        3: { title: "Installing", sub: "Keep this window open until it's done." },
      },
      btnSignIn: "Sign in with Leadbay",
      btnInstall: "Install",
      btnBack: "Back",
      btnRefresh: "Refresh",
      noClientsDetected: "No supported MCP client detected on this machine.",
      noAgentsDetected: "No supported agents detected.",
      selectAtLeastOne: "Select at least one agent.",
      openingSignIn: "Opening Leadbay sign-in in your browser...",
      oauthFailed: "OAuth login failed.",
      successInstalled: "MCP successfully installed",
      noneInstalled: "No agents were installed.",
      streamDisconnected: "Install stream disconnected.",
      closeWindow: "You can close this window.",
      allSet: "All set",
      somethingWrong: "Something went wrong",
      badgeManual: "manual",
      badgeUpdate: "update",
      badgeInstall: "install",
    },
    uninstaller: {
      docTitle: "Leadbay MCP uninstaller",
      steps: {
        1: { title: "Remove Leadbay MCP", sub: "Select the agents to remove Leadbay MCP from." },
        2: { title: "Removing", sub: "Keep this window open until it's done." },
      },
      btnRemove: "Remove selected",
      btnBack: "Back",
      btnRefresh: "Refresh",
      noInstallDetected: "No Leadbay MCP installation detected on this machine.",
      selectAtLeastOne: "Select at least one agent.",
      successRemoved: "MCP successfully removed",
      noneRemoved: "No agents were removed.",
      streamDisconnected: "Uninstall stream disconnected.",
      closeWindow: "You can close this window.",
      allSet: "All set",
      somethingWrong: "Something went wrong",
    },
    server: {
      loginExpired: "Login expired. Go back and sign in again.",
      selectAtLeastOne: "Select at least one agent.",
      noSelectedDetected: "No selected agents were detected on this machine.",
      installStopped: "Install stopped.",
      uninstallStopped: "Uninstall stopped.",
      connectedTo: (label) => `Connected to ${label}.`,
      toolFlags: (write, telemetry) => `Write tools ${write ? "enabled" : "disabled"}; telemetry ${telemetry ? "enabled" : "disabled"}.`,
      refreshingDetection: "Refreshing installed-agent detection...",
      installing: (label) => `Installing ${label}...`,
      preparingManual: (label) => `Preparing ${label} manual setup...`,
      removing: (label) => `Removing from ${label}...`,
      installedSummary: (ok, total) => `${ok}/${total} agent(s) installed, updated, or prepared.`,
      manualReady: "Manual ChatGPT setup instructions ready.",
      removedSummary: (ok, total) => `${ok}/${total} agent(s) removed.`,
      restartClients: "Restart your MCP client(s) to pick up the new server.",
      followManual: "Follow the manual setup instructions shown above.",
      completeRemoval: "Restart your MCP client(s) to complete the removal.",
      loggedInBackend: (region) => `Logged in to ${region.toUpperCase()} backend.`,
      settingsLine: (write, telemetry) => `Settings: write tools ${write ? "on" : "off"}, telemetry ${telemetry ? "on" : "off"}.`,
      installSummaryHeader: "Install summary:",
      noAgentsRemoved: "No agents were removed.",
    },
  },
  fr: {
    installer: {
      docTitle: "Installateur Leadbay MCP",
      steps: {
        1: { title: "Connectez Leadbay", sub: "Connectez-vous pour installer Leadbay sur vos agents IA." },
        2: { title: "Choisissez vos agents", sub: "Choisissez où installer Leadbay." },
        3: { title: "Installation en cours", sub: "Gardez cette fenêtre ouverte jusqu'à la fin." },
      },
      btnSignIn: "Se connecter avec Leadbay",
      btnInstall: "Installer",
      btnBack: "Retour",
      btnRefresh: "Actualiser",
      noClientsDetected: "Aucun client MCP compatible détecté sur cette machine.",
      noAgentsDetected: "Aucun agent compatible détecté.",
      selectAtLeastOne: "Sélectionnez au moins un agent.",
      openingSignIn: "Ouverture de la connexion Leadbay dans votre navigateur...",
      oauthFailed: "Échec de la connexion OAuth.",
      successInstalled: "MCP installé avec succès",
      noneInstalled: "Aucun agent n'a été installé.",
      streamDisconnected: "Flux d'installation interrompu.",
      closeWindow: "Vous pouvez fermer cette fenêtre.",
      allSet: "Terminé",
      somethingWrong: "Une erreur est survenue",
      badgeManual: "manuel",
      badgeUpdate: "mettre à jour",
      badgeInstall: "installer",
    },
    uninstaller: {
      docTitle: "Désinstallateur Leadbay MCP",
      steps: {
        1: { title: "Supprimer Leadbay MCP", sub: "Sélectionnez les agents desquels supprimer Leadbay MCP." },
        2: { title: "Suppression en cours", sub: "Gardez cette fenêtre ouverte jusqu'à la fin." },
      },
      btnRemove: "Supprimer la sélection",
      btnBack: "Retour",
      btnRefresh: "Actualiser",
      noInstallDetected: "Aucune installation Leadbay MCP détectée sur cette machine.",
      selectAtLeastOne: "Sélectionnez au moins un agent.",
      successRemoved: "MCP supprimé avec succès",
      noneRemoved: "Aucun agent n'a été supprimé.",
      streamDisconnected: "Flux de désinstallation interrompu.",
      closeWindow: "Vous pouvez fermer cette fenêtre.",
      allSet: "Terminé",
      somethingWrong: "Une erreur est survenue",
    },
    server: {
      loginExpired: "Session expirée. Revenez en arrière et reconnectez-vous.",
      selectAtLeastOne: "Sélectionnez au moins un agent.",
      noSelectedDetected: "Aucun des agents sélectionnés n'a été détecté sur cette machine.",
      installStopped: "Installation arrêtée.",
      uninstallStopped: "Désinstallation arrêtée.",
      connectedTo: (label) => `Connecté à ${label}.`,
      toolFlags: (write, telemetry) => `Outils d'écriture ${write ? "activés" : "désactivés"} ; télémétrie ${telemetry ? "activée" : "désactivée"}.`,
      refreshingDetection: "Actualisation de la détection des agents installés...",
      installing: (label) => `Installation de ${label}...`,
      preparingManual: (label) => `Préparation de la configuration manuelle de ${label}...`,
      removing: (label) => `Suppression de ${label}...`,
      installedSummary: (ok, total) => `${ok}/${total} agent(s) installé(s), mis à jour ou préparé(s).`,
      manualReady: "Instructions de configuration manuelle de ChatGPT prêtes.",
      removedSummary: (ok, total) => `${ok}/${total} agent(s) supprimé(s).`,
      restartClients: "Redémarrez votre/vos client(s) MCP pour charger le nouveau serveur.",
      followManual: "Suivez les instructions de configuration manuelle ci-dessus.",
      completeRemoval: "Redémarrez votre/vos client(s) MCP pour terminer la suppression.",
      loggedInBackend: (region) => `Connecté au backend ${region.toUpperCase()}.`,
      settingsLine: (write, telemetry) => `Paramètres : outils d'écriture ${write ? "activés" : "désactivés"}, télémétrie ${telemetry ? "activée" : "désactivée"}.`,
      installSummaryHeader: "Récapitulatif de l'installation :",
      noAgentsRemoved: "Aucun agent n'a été supprimé.",
    },
  },
};

// Probe GeoIP server-side to pick the page locale. Any failure → English; a
// locale probe must never break the installer page.
async function detectLocale(): Promise<Locale> {
  try {
    return (await inferRegionViaStargate({ staging: false })) === "fr" ? "fr" : "en";
  } catch {
    return "en";
  }
}

function parseLocale(raw: string | null | undefined): Locale {
  return raw === "fr" ? "fr" : "en";
}

type InstallRequest = { sessionId?: string; clientIds?: string[]; includeWrite?: boolean; telemetryEnabled?: boolean };
type LoginSession = { token: string; region: "us" | "fr"; accountLabel: string; createdAt: number };
type InstallResult = { id: string; label: string; ok: boolean; message: string };
type LogLevel = "info" | "active" | "success" | "error" | "done";

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
  if (!session) return { ok: false, output: MESSAGES.en.server.loginExpired };
  if (!clientIds.length) return { ok: false, output: MESSAGES.en.server.selectAtLeastOne };

  const locale: Locale = session.region === "fr" ? "fr" : "en";
  const s = MESSAGES[locale].server;

  const detected = await detectClients();
  const selected = detected.filter((client) => clientIds.includes(client.id));
  if (!selected.length) return { ok: false, output: s.noSelectedDetected };

  const includeWrite = body.includeWrite !== false;
  const telemetryEnabled = body.telemetryEnabled !== false;
  const results: InstallResult[] = [];
  for (const client of selected) results.push(await installInto(client, session, includeWrite, telemetryEnabled));

  const output = [
    s.loggedInBackend(session.region),
    s.settingsLine(includeWrite, telemetryEnabled),
    "",
    s.installSummaryHeader,
    ...results.map((result) => `${result.ok ? "OK" : "ERROR"} ${result.label}: ${result.message}`),
    "",
    s.restartClients,
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
  const locale = parseLocale(url.searchParams.get("locale"));
  const s = MESSAGES[locale].server;
  const emit = (level: LogLevel, message: string) => sendSse(res, { level, message: sanitizeOutput(message) });

  // abort: recoverable error — close the stream but leave the server running so the user can retry.
  const abort = (msg: string) => { emit("done", msg); res.end(); };
  // finish: successful completion — close stream and signal the process to exit.
  const finish = (msg: string) => { emit("done", msg); res.end(); onDone?.(); };

  if (!session) { emit("error", s.loginExpired); abort(s.installStopped); return; }
  if (!clientIds.length) { emit("error", s.selectAtLeastOne); abort(s.installStopped); return; }

  emit("info", s.connectedTo(session.accountLabel));
  emit("info", s.toolFlags(includeWrite, telemetryEnabled));
  emit("info", s.refreshingDetection);

  const detected = await detectClients();
  const selected = detected.filter((client) => clientIds.includes(client.id));
  const selectedHasOnlyManualSetup = selected.length > 0 && selected.every(isManualSetupClient);
  if (!selected.length) { emit("error", s.noSelectedDetected); abort(s.installStopped); return; }

  let okCount = 0;
  for (const client of selected) {
    emit("active", isManualSetupClient(client) ? s.preparingManual(client.label) : s.installing(client.label));
    const result = await installInto(client, session, includeWrite, telemetryEnabled);
    if (result.ok) { okCount += 1; emit("success", `${result.label}: ${result.message}`); }
    else { emit("error", `${result.label}: ${result.message}`); }
  }

  const summary = selectedHasOnlyManualSetup ? s.manualReady : s.installedSummary(okCount, selected.length);
  const closing = selectedHasOnlyManualSetup ? s.followManual : s.restartClients;
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
  const locale = parseLocale(url.searchParams.get("locale"));
  const s = MESSAGES[locale].server;
  const emit = (level: LogLevel, message: string) => sendSse(res, { level, message });
  const abort = (msg: string) => { emit("done", msg); res.end(); };
  const finish = (msg: string) => { emit("done", msg); res.end(); onDone?.(); };

  if (!clientIds.length) { emit("error", s.selectAtLeastOne); abort(s.uninstallStopped); return; }

  const detected = await detectClients();
  const selected = detected.filter((c) => clientIds.includes(c.id));
  if (!selected.length) { emit("error", s.noSelectedDetected); abort(s.uninstallStopped); return; }

  let okCount = 0;
  for (const client of selected) {
    emit("active", s.removing(client.label));
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

  emit(okCount > 0 ? "success" : "error", s.removedSummary(okCount, selected.length));
  finish(s.completeRemoval);
}

export function pageUninstallHtml(locale: Locale = "en"): string {
  const ui = MESSAGES[locale].uninstaller;
  return `<!doctype html>
<html lang="${locale}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${ui.docTitle}</title>
  <style>
    :root { color-scheme: light; --bg:#fff; --card:#fff; --strong:#1d2228; --muted:#9aa0ab; --line:#e7e9ee; --accent:#0d0f0e; --danger:#d14343; --ok:#16a34a; --warn:#b06a00; }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100vh; background:var(--bg); color:var(--strong); font:14px/1.55 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif; display:flex; align-items:center; justify-content:center; padding:32px 24px; -webkit-font-smoothing:antialiased; }
    main { width:min(420px,100%); }
    .steps { display:flex; gap:6px; justify-content:center; margin-bottom:18px; }
    .dot { width:24px; height:3px; border-radius:999px; background:var(--line); transition:background .2s; }
    .dot.active,.dot.done { background:var(--danger); }
    .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:30px 26px; }
    h1 { font-size:18px; line-height:1.3; margin:0 0 6px; font-weight:700; color:var(--strong); text-align:center; }
    .sub { color:var(--muted); text-align:center; margin:0; min-height:1.55em; }
    .sub.err { color:var(--danger); }
    .hidden { display:none !important; }
    .spinner { width:26px; height:26px; margin:18px auto 0; border:3px solid var(--line); border-top-color:var(--danger); border-radius:50%; animation:spin .7s linear infinite; }
    @keyframes spin { to { transform:rotate(360deg); } }
    .agents { display:grid; gap:8px; margin-top:18px; }
    .agent { display:grid; grid-template-columns:auto 1fr; gap:11px; align-items:center; padding:11px 13px; border:1px solid var(--line); border-radius:10px; cursor:pointer; transition:border-color .15s; }
    .agent:hover { border-color:var(--muted); }
    .agent strong { display:block; font-weight:650; color:var(--strong); }
    .agent .detail { color:var(--muted); font-size:12px; word-break:break-all; }
    .agent input { width:16px; height:16px; accent-color:var(--danger); }
    .actions { display:flex; gap:12px; justify-content:center; margin-top:22px; }
    button { min-height:42px; border-radius:9px; border:1px solid var(--line); background:var(--card); color:var(--strong); padding:9px 22px; font:inherit; font-weight:650; cursor:pointer; transition:opacity .15s,transform .05s; }
    button:active { transform:translateY(1px); }
    button.danger { background:var(--danger); border-color:var(--danger); color:#fff; }
    button.danger:hover { opacity:.88; }
    button.ghost { border:0; background:transparent; color:var(--muted); padding:9px 14px; }
    button:disabled { opacity:.45; cursor:default; }
    /* result state — animated check / cross */
    .result { display:flex; flex-direction:column; align-items:center; gap:14px; padding:8px 0 4px; }
    .ring { width:64px; height:64px; }
    .ring circle { fill:none; stroke-width:3; stroke-linecap:round; stroke-dasharray:170; stroke-dashoffset:170; animation:draw .5s ease-out forwards; }
    .ring path { fill:none; stroke:#fff; stroke-width:3.5; stroke-linecap:round; stroke-linejoin:round; stroke-dasharray:48; stroke-dashoffset:48; animation:draw .35s .45s ease-out forwards; }
    .ring .disc { stroke:none; }
    .ring.ok circle:not(.disc) { stroke:var(--ok); }
    .ring.err circle:not(.disc) { stroke:var(--danger); }
    .ring.ok .disc { fill:var(--ok); animation:pop .4s ease-out; }
    .ring.err .disc { fill:var(--danger); animation:pop .4s ease-out; }
    .result-msg { font-size:15px; font-weight:700; color:var(--strong); text-align:center; }
    .result.err .result-msg { color:var(--danger); }
    .result-note { font-size:12.5px; color:var(--muted); text-align:center; margin-top:-6px; }
    @keyframes draw { to { stroke-dashoffset:0; } }
    @keyframes pop { 0%{transform:scale(.5);opacity:0;} 60%{transform:scale(1.06);} 100%{transform:scale(1);opacity:1;} }
    .version { text-align:center; color:var(--muted); font-size:11px; margin:14px 0 0; letter-spacing:.02em; }
    @media (max-width:520px) { .actions{flex-direction:column;} button{width:100%;} }
  </style>
</head>
<body>
  <main>
    <div class="steps"><div class="dot active" id="dot-1"></div><div class="dot" id="dot-2"></div></div>
    <div class="card">
      <h1 id="title">${ui.steps[1].title}</h1>
      <p class="sub" id="sub">${ui.steps[1].sub}</p>

      <section id="step-1">
        <div class="spinner" id="spinner"></div>
        <div class="agents" id="agents"></div>
      </section>

      <section id="result" class="result hidden">
        <svg class="ring" id="ring" viewBox="0 0 64 64" aria-hidden="true">
          <circle class="disc" cx="32" cy="32" r="28"></circle>
          <circle cx="32" cy="32" r="28"></circle>
          <path id="ring-mark" d="M20 33 l8 8 l16 -18"></path>
        </svg>
        <div class="result-msg" id="result-msg"></div>
        <div class="result-note" id="result-note"></div>
      </section>

      <div class="actions">
        <button id="back" class="ghost hidden">${ui.btnBack}</button>
        <button id="refresh">${ui.btnRefresh}</button>
        <button class="danger" id="next">${ui.btnRemove}</button>
      </div>
    </div>
    <p class="version">v${VERSION}</p>
  </main>
  <script>
    const LOCALE = "${locale}";
    const T = ${JSON.stringify(ui)};
    const $ = (id) => document.getElementById(id);
    const STEPS = T.steps;
    const CHECK = "M20 33 l8 8 l16 -18";
    const CROSS = "M22 22 l20 20 M42 22 l-20 20";
    let step = 1;
    let clients = [];
    function say(text, error = false) { const s = $("sub"); s.textContent = text; s.classList.toggle("err", !!error); }
    function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
    function setStep(n) { step = n; [1,2].forEach((i) => { const dot = $("dot-" + i); dot.classList.toggle("active", i === step); dot.classList.toggle("done", i < step); }); $("step-1").classList.toggle("hidden", step !== 1); $("result").classList.add("hidden"); $("title").textContent = STEPS[step].title; say(STEPS[step].sub); $("next").classList.toggle("hidden", step === 2); $("refresh").classList.toggle("hidden", step === 2); }
    // Final completion state: animated green check / red cross + message.
    function showResult(ok, msg) {
      $("sub").classList.add("hidden");
      $("result-msg").textContent = msg;
      $("result-note").textContent = ok ? T.closeWindow : "";
      $("ring-mark").setAttribute("d", ok ? CHECK : CROSS);
      const ring = $("ring"); ring.classList.remove("ok", "err"); void ring.getBoundingClientRect();
      ring.classList.add(ok ? "ok" : "err");
      $("result").classList.toggle("err", !ok);
      $("result").classList.remove("hidden");
      $("title").textContent = ok ? T.allSet : T.somethingWrong;
      ["next", "back", "refresh"].forEach((id) => $(id).classList.add("hidden"));
    }
    function renderAgents() { $("spinner").classList.add("hidden"); const root = $("agents"); if (!clients.length) { root.innerHTML = '<div class="sub">' + esc(T.noInstallDetected) + '</div>'; return; } root.innerHTML = clients.map((c) => '<label class="agent"><input type="checkbox" data-client="' + esc(c.id) + '" checked /><span><strong>' + esc(c.label) + '</strong><span class="detail">' + esc(c.detail) + '</span></span></label>').join(""); }
    async function refresh() { $("spinner").classList.remove("hidden"); $("agents").innerHTML = ""; const res = await fetch("/api/status"); const data = await res.json(); clients = (data.clients || []).filter((c) => c.configured); renderAgents(); if (!clients.length) say(T.noInstallDetected); }
    async function doUninstall() { const selected = [...document.querySelectorAll("[data-client]:checked")].map((el) => el.dataset.client); if (!selected.length) return say(T.selectAtLeastOne, true); setStep(2); let okCount = 0, lastError = ""; const params = new URLSearchParams({ clients: selected.join(","), locale: LOCALE }); const events = new EventSource("/api/uninstall-stream?" + params.toString()); events.onmessage = (event) => { const data = JSON.parse(event.data); if (data.level === "error") lastError = data.message; if (data.level === "success") okCount += 1; if (data.level === "done") { events.close(); const ok = okCount > 0 && !lastError; showResult(ok, ok ? T.successRemoved : (lastError || T.noneRemoved)); } else { say(data.message, data.level === "error"); } }; events.onerror = () => { events.close(); showResult(false, T.streamDisconnected); }; }
    $("back").addEventListener("click", () => setStep(1));
    $("refresh").addEventListener("click", refresh);
    $("next").addEventListener("click", doUninstall);
    refresh();
  </script>
</body>
</html>`;
}

export function pageHtml(locale: Locale = "en"): string {
  const ui = MESSAGES[locale].installer;
  return `<!doctype html>
<html lang="${locale}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${ui.docTitle}</title>
  <style>
    :root { color-scheme: light; --bg:#fff; --card:#fff; --strong:#1d2228; --muted:#9aa0ab; --line:#e7e9ee; --accent:#0d0f0e; --cancel-line:#f0c8b8; --danger:#d14343; --ok:#16a34a; --warn:#b06a00; }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100vh; background:var(--bg); color:var(--strong); font:14px/1.55 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,sans-serif; display:flex; align-items:center; justify-content:center; padding:32px 24px; -webkit-font-smoothing:antialiased; }
    main { width:min(420px,100%); }
    .steps { display:flex; gap:6px; justify-content:center; margin-bottom:18px; }
    .dot { width:24px; height:3px; border-radius:999px; background:var(--line); transition:background .2s; }
    .dot.active,.dot.done { background:var(--accent); }
    .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:30px 26px; }
    h1 { font-size:18px; line-height:1.3; margin:0 0 6px; font-weight:700; color:var(--strong); text-align:center; }
    .sub { color:var(--muted); text-align:center; margin:0; min-height:1.55em; }
    .sub.err { color:var(--danger); }
    .hidden { display:none !important; }
    .spinner { width:26px; height:26px; margin:18px auto 0; border:3px solid var(--line); border-top-color:var(--accent); border-radius:50%; animation:spin .7s linear infinite; }
    @keyframes spin { to { transform:rotate(360deg); } }
    .agents { display:grid; gap:8px; margin-top:18px; }
    .agent { display:grid; grid-template-columns:auto 1fr; gap:11px; align-items:center; padding:11px 13px; border:1px solid var(--line); border-radius:10px; cursor:pointer; transition:border-color .15s; }
    .agent:hover { border-color:var(--muted); }
    .agent strong { display:block; font-weight:650; color:var(--strong); }
    .agent .detail { color:var(--muted); font-size:12px; word-break:break-all; }
    .agent input { width:16px; height:16px; accent-color:var(--accent); }
    .badge-pill { font-size:9.5px; font-weight:700; padding:1px 6px; border-radius:999px; vertical-align:middle; text-transform:uppercase; letter-spacing:.03em; }
    .badge-install { background:color-mix(in srgb,var(--ok),transparent 88%); color:var(--ok); }
    .badge-update { background:color-mix(in srgb,var(--warn),transparent 86%); color:var(--warn); }
    .actions { display:flex; gap:12px; justify-content:center; margin-top:22px; }
    button { min-height:42px; border-radius:9px; border:1px solid var(--line); background:var(--card); color:var(--strong); padding:9px 26px; font:inherit; font-weight:650; cursor:pointer; transition:opacity .15s,transform .05s; }
    button:active { transform:translateY(1px); }
    button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
    button.primary:hover { opacity:.88; }
    button.cancel { border-color:var(--cancel-line); }
    button.ghost { border:0; background:transparent; color:var(--muted); padding:9px 14px; }
    button:disabled { opacity:.45; cursor:default; }
    /* result state — animated check / cross */
    .result { display:flex; flex-direction:column; align-items:center; gap:14px; padding:8px 0 4px; }
    .ring { width:64px; height:64px; }
    .ring circle { fill:none; stroke-width:3; stroke-linecap:round; stroke-dasharray:170; stroke-dashoffset:170; animation:draw .5s ease-out forwards; }
    .ring path { fill:none; stroke:#fff; stroke-width:3.5; stroke-linecap:round; stroke-linejoin:round; stroke-dasharray:48; stroke-dashoffset:48; animation:draw .35s .45s ease-out forwards; }
    .ring .disc { stroke:none; }
    .ring.ok circle:not(.disc) { stroke:var(--ok); }
    .ring.err circle:not(.disc) { stroke:var(--danger); }
    .ring.ok .disc { fill:var(--ok); animation:pop .4s ease-out; }
    .ring.err .disc { fill:var(--danger); animation:pop .4s ease-out; }
    .result-msg { font-size:15px; font-weight:700; color:var(--strong); text-align:center; }
    .result.err .result-msg { color:var(--danger); }
    .result-note { font-size:12.5px; color:var(--muted); text-align:center; margin-top:-6px; }
    @keyframes draw { to { stroke-dashoffset:0; } }
    @keyframes pop { 0%{transform:scale(.5);opacity:0;} 60%{transform:scale(1.06);} 100%{transform:scale(1);opacity:1;} }
    .version { text-align:center; color:var(--muted); font-size:11px; margin:14px 0 0; letter-spacing:.02em; }
    @media (max-width:520px) { .actions{flex-direction:column;} button{width:100%;} }
  </style>
</head>
<body>
  <main>
    <div class="steps"><div class="dot active" id="dot-1"></div><div class="dot" id="dot-2"></div><div class="dot" id="dot-3"></div></div>
    <div class="card">
      <h1 id="title">${ui.steps[1].title}</h1>
      <p class="sub" id="sub">${ui.steps[1].sub}</p>

      <section id="step-2" class="hidden">
        <div class="spinner" id="spinner"></div>
        <div class="agents" id="agents"></div>
      </section>

      <section id="result" class="result hidden">
        <svg class="ring" id="ring" viewBox="0 0 64 64" aria-hidden="true">
          <circle class="disc" cx="32" cy="32" r="28"></circle>
          <circle cx="32" cy="32" r="28"></circle>
          <path id="ring-mark" d="M20 33 l8 8 l16 -18"></path>
        </svg>
        <div class="result-msg" id="result-msg"></div>
        <div class="result-note" id="result-note"></div>
      </section>

      <div class="actions">
        <button id="back" class="cancel hidden">${ui.btnBack}</button>
        <button id="refresh" class="ghost hidden">${ui.btnRefresh}</button>
        <button class="primary" id="next">${ui.btnSignIn}</button>
      </div>
    </div>
    <p class="version">v${VERSION}</p>
  </main>
  <script>
    const LOCALE = "${locale}";
    const T = ${JSON.stringify(ui)};
    const $ = (id) => document.getElementById(id);
    const STEPS = T.steps;
    const CHECK = "M20 33 l8 8 l16 -18";
    const CROSS = "M22 22 l20 20 M42 22 l-20 20";
    let step = 1;
    let sessionId = null;
    let clients = [];
    function say(text, error = false) { const s = $("sub"); s.textContent = text; s.classList.toggle("err", !!error); }
    function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
    function setStep(next) {
      step = next;
      [1,2,3].forEach((n) => { const dot = $("dot-" + n); dot.classList.toggle("active", n === step); dot.classList.toggle("done", n < step); });
      $("step-2").classList.toggle("hidden", step !== 2);
      $("result").classList.add("hidden");
      $("title").textContent = STEPS[step].title;
      say(STEPS[step].sub);
      $("back").classList.toggle("hidden", step !== 2);
      $("refresh").classList.toggle("hidden", step !== 2);
      $("next").classList.toggle("hidden", step === 3);
      $("next").textContent = step === 2 ? T.btnInstall : T.btnSignIn;
    }
    // Final completion state: animated green check / red cross + message.
    function showResult(ok, msg) {
      $("sub").classList.add("hidden");
      $("result-msg").textContent = msg;
      $("result-note").textContent = ok ? T.closeWindow : "";
      $("ring-mark").setAttribute("d", ok ? CHECK : CROSS);
      const ring = $("ring"); ring.classList.remove("ok", "err"); void ring.getBoundingClientRect();
      ring.classList.add(ok ? "ok" : "err");
      $("result").classList.toggle("err", !ok);
      $("result").classList.remove("hidden");
      $("title").textContent = ok ? T.allSet : T.somethingWrong;
      ["next", "back", "refresh"].forEach((id) => $(id).classList.add("hidden"));
    }
    function renderAgents() { $("spinner").classList.add("hidden"); const root = $("agents"); if (!clients.length) { root.innerHTML = '<div class="sub">' + esc(T.noClientsDetected) + '</div>'; return; } root.innerHTML = clients.map((client) => { const manual = client.id === "chatgpt-desktop"; const badgeText = manual ? T.badgeManual : client.configured ? T.badgeUpdate : T.badgeInstall; const badgeClass = manual ? "badge-update" : client.configured ? "badge-update" : "badge-install"; return '<label class="agent"><input type="checkbox" data-client="' + esc(client.id) + '" checked /><span><strong>' + esc(client.label) + ' <span class="badge-pill ' + badgeClass + '">' + esc(badgeText) + '</span></strong><span class="detail">' + esc(client.detail) + '</span></span></label>'; }).join(""); }
    async function refresh() { $("spinner").classList.remove("hidden"); $("agents").innerHTML = ""; const res = await fetch("/api/status"); const data = await res.json(); clients = data.clients || []; renderAgents(); if (!clients.length) say(T.noAgentsDetected); }
    async function doLogin() { $("next").disabled = true; say(T.openingSignIn); try { const res = await fetch("/api/oauth-login", { method:"POST" }); const data = await res.json(); if (!data.ok) return say(data.error || T.oauthFailed, true); sessionId = data.sessionId; setStep(2); await refresh(); } finally { $("next").disabled = false; } }
    async function install() {
      const selected = [...document.querySelectorAll("[data-client]:checked")].map((el) => el.dataset.client);
      if (!selected.length) return say(T.selectAtLeastOne, true);
      setStep(3);
      let okCount = 0, lastError = "";
      const params = new URLSearchParams({ sessionId, clients: selected.join(","), write: "1", telemetry: "1", locale: LOCALE });
      const events = new EventSource("/api/install-stream?" + params.toString());
      events.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.level === "error") lastError = data.message;
        if (data.level === "success") okCount += 1;
        if (data.level === "done") {
          events.close();
          const ok = okCount > 0 && !lastError;
          showResult(ok, ok ? T.successInstalled : (lastError || T.noneInstalled));
        } else {
          say(data.message, data.level === "error");
        }
      };
      events.onerror = () => { events.close(); showResult(false, T.streamDisconnected); };
    }
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
  pageContent: () => string | Promise<string>,
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
        const raw = await pageContent();
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
  return makeGuiServer(options, async () => pageHtml(await detectLocale()), async (req, res, onDone) => {
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
  return makeGuiServer(options, async () => pageUninstallHtml(await detectLocale()), async (req, res, onDone) => {
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

