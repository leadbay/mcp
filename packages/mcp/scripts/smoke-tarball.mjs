#!/usr/bin/env node
/**
 * Release gate: launch a packed @leadbay/mcp tarball exactly the way the
 * installers make every client launch it, and refuse it unless it answers an
 * MCP handshake.
 *
 * Why: every installed client runs `npx -y --package=@leadbay/mcp@latest
 * leadbay-mcp` on each restart, so whatever `latest` points to reaches every
 * seat at once. The unit tests in release.yml run against the workspace
 * sources, not the tarball. A tarball that is missing a dist file, imports a
 * workspace package that was not bundled, or crashes at startup passes them
 * and still breaks every user. This script runs the tarball itself, from a
 * clean directory outside the workspace, and release.yml publishes that same
 * tarball only if it passes.
 *
 * It starts the server with no LEADBAY_TOKEN and telemetry off: the server
 * still answers `initialize` and `tools/list` in that state (see
 * resolveClientFromEnv in src/bin.ts), so nothing here needs a secret or
 * reaches the Leadbay API.
 *
 * Usage: node scripts/smoke-tarball.mjs <path/to/leadbay-mcp-X.Y.Z.tgz> [expected-version]
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 300_000);
// A tool every build must serve. If the tool list comes back without it, the
// server started but lost its registry, which is as bad as not starting.
const REQUIRED_TOOL = "leadbay_pull_leads";

const [, , tarballArg, expectedVersion] = process.argv;
if (!tarballArg) {
  console.error("usage: smoke-tarball.mjs <tarball.tgz> [expected-version]");
  process.exit(2);
}
const tarball = resolve(tarballArg);
if (!existsSync(tarball)) {
  console.error(`smoke: tarball not found: ${tarball}`);
  process.exit(2);
}

const work = mkdtempSync(join(tmpdir(), "leadbay-mcp-smoke-"));

// Start from a clean environment: no Leadbay credentials, no OAuth bootstrap,
// and a HOME with no ~/.config/leadbay, so the run cannot pick up a token.
const env = {};
for (const [k, v] of Object.entries(process.env)) {
  if (!k.startsWith("LEADBAY_")) env[k] = v;
}
env.HOME = work;
env.USERPROFILE = work;
env.npm_config_cache = join(work, ".npm");
env.LEADBAY_TELEMETRY_ENABLED = "false";
env.LEADBAY_REGION = "us";
// The installer wizard's optional Electron dependency is not needed to serve
// MCP; skipping its binary download keeps the gate fast.
env.ELECTRON_SKIP_BINARY_DOWNLOAD = "1";

const npx = process.platform === "win32" ? "npx.cmd" : "npx";
// Same shape as install-claude-code.ts / install-json-config.ts, with the
// tarball in place of `@leadbay/mcp@latest`.
const child = spawn(npx, ["-y", `--package=${tarball}`, "leadbay-mcp"], {
  cwd: work,
  env,
  stdio: ["pipe", "pipe", "pipe"],
});

let stderr = "";
child.stderr.on("data", (d) => (stderr += d.toString()));

const pending = new Map();
let buf = "";
child.stdout.on("data", (d) => {
  buf += d.toString();
  let nl;
  while ((nl = buf.indexOf("\n")) !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue; // not JSON-RPC; stdout noise is checked below
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

let exited = null;
child.on("exit", (code, signal) => {
  exited = { code, signal };
  for (const resolveFn of pending.values()) resolveFn({ error: { message: `server exited (code=${code} signal=${signal})` } });
  pending.clear();
});

let nextId = 1;
function request(method, params) {
  const id = nextId++;
  return new Promise((resolveFn) => {
    pending.set(id, resolveFn);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

function fail(reason) {
  console.error(`smoke: FAIL: ${reason}`);
  if (stderr.trim()) console.error(`--- server stderr ---\n${stderr.trim().slice(-4000)}`);
  cleanup(1);
}

function cleanup(code) {
  clearTimeout(timer);
  if (exited === null) child.kill("SIGKILL");
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
  process.exit(code);
}

const timer = setTimeout(() => fail(`no complete handshake within ${TIMEOUT_MS}ms`), TIMEOUT_MS);

try {
  const init = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "leadbay-release-smoke", version: "1" },
  });
  if (init.error) fail(`initialize: ${init.error.message}`);
  const server = init.result?.serverInfo;
  if (!server) fail("initialize returned no serverInfo");
  if (expectedVersion && server.version !== expectedVersion) {
    fail(`serverInfo.version is ${server.version}, expected ${expectedVersion}`);
  }
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  const list = await request("tools/list", {});
  if (list.error) fail(`tools/list: ${list.error.message}`);
  const names = (list.result?.tools ?? []).map((t) => t.name);
  if (names.length === 0) fail("tools/list returned no tools");
  if (!names.includes(REQUIRED_TOOL)) fail(`tools/list is missing ${REQUIRED_TOOL} (got ${names.length} tools)`);

  console.log(`smoke: OK: ${server.name} ${server.version} answered initialize and served ${names.length} tools`);
  cleanup(0);
} catch (err) {
  fail(err?.message ?? String(err));
}
