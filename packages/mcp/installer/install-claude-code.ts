import { spawn } from "node:child_process";

export function buildClaudeCodeAddArgs(
  token: string,
  region: "us" | "fr",
  includeWrite: boolean,
  telemetryEnabled: boolean
): string[] {
  const args = [
    "mcp",
    "add",
    "leadbay",
    "--scope",
    "user",
    "--env",
    `LEADBAY_TOKEN=${token}`,
    "--env",
    `LEADBAY_REGION=${region}`,
    "--env",
    `LEADBAY_TELEMETRY_ENABLED=${telemetryEnabled ? "true" : "false"}`,
  ];
  if (!includeWrite) args.push("--env", `LEADBAY_MCP_WRITE=0`);
  args.push("--", "npx", "-y", "@leadbay/mcp@latest");
  return args;
}

export function buildClaudeCodeRemoveArgs(): string[] {
  return ["mcp", "remove", "leadbay", "--scope", "user"];
}

export async function runClaudeMcp(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string; spawnError?: string }> {
  return await new Promise((resolve) => {
    const child = spawn("claude", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.on("error", (err) => resolve({ code: null, stdout, stderr, spawnError: err.message }));
  });
}

export async function isLeadbayConfiguredInClaudeCode(): Promise<boolean> {
  const result = await runClaudeMcp(["mcp", "list"]);
  if (result.spawnError || result.code !== 0) return false;
  return /^leadbay:/m.test(result.stdout);
}

export async function installInClaudeCode(
  token: string,
  region: "us" | "fr",
  includeWrite: boolean,
  telemetryEnabled: boolean
): Promise<{ ok: boolean; message: string }> {
  const args = buildClaudeCodeAddArgs(token, region, includeWrite, telemetryEnabled);
  const first = await runClaudeMcp(args);
  if (first.spawnError) return { ok: false, message: `failed to spawn claude: ${first.spawnError}` };
  if (first.code === 0) return { ok: true, message: "registered" };

  const stderr = first.stderr.trim();
  if (!/already exists/i.test(stderr)) {
    return { ok: false, message: `claude mcp add exited ${first.code}: ${stderr.slice(0, 200)}` };
  }

  const removed = await runClaudeMcp(buildClaudeCodeRemoveArgs());
  if (removed.spawnError) return { ok: false, message: `failed to spawn claude: ${removed.spawnError}` };
  if (removed.code !== 0) {
    return { ok: false, message: `claude mcp remove exited ${removed.code}: ${removed.stderr.trim().slice(0, 200)}` };
  }

  const second = await runClaudeMcp(args);
  if (second.spawnError) return { ok: false, message: `failed to spawn claude: ${second.spawnError}` };
  return {
    ok: second.code === 0,
    message: second.code === 0
      ? "updated"
      : `claude mcp add exited ${second.code}: ${second.stderr.trim().slice(0, 200)}`,
  };
}

export async function uninstallFromClaudeCode(): Promise<{ ok: boolean; message: string }> {
  const result = await runClaudeMcp(buildClaudeCodeRemoveArgs());
  if (result.spawnError) return { ok: false, message: `failed to spawn claude: ${result.spawnError}` };
  if (result.code === 0) return { ok: true, message: "removed" };
  const stderr = result.stderr.trim();
  if (/not found|does not exist|no server/i.test(stderr)) return { ok: true, message: "already absent" };
  return { ok: false, message: `claude mcp remove exited ${result.code}: ${stderr.slice(0, 200)}` };
}
