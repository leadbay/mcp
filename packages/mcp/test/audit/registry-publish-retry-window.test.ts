/**
 * Audit: the MCP Registry publish retry loop outlasts npm's read replica.
 *
 * The registry re-checks npm before it registers a version, and answers
 *   NPM package '@leadbay/mcp' exists, but version 'x.y.z' was not found
 *   (status: 404)
 * while npm is still propagating. Measured on the 16 September 2026 releases,
 * from the moment `npm publish` returned to the moment the registry accepted
 * the version on the rerun:
 *
 *   0.39.1  03:32:18Z -> 03:36:24Z   246s
 *   0.39.2  05:13:35Z -> 05:17:11Z   216s
 *   0.39.4  06:28:57Z -> 06:33:44Z   287s
 *   0.39.5  07:02:30Z -> 07:05:52Z   202s
 *
 * The loop spanned 5 attempts x 30s, so it gave up at ~150s and four of the
 * last five releases needed `gh run rerun --failed`.
 *
 * This test lifts the loop verbatim out of release.yml and runs it against a
 * stub mcp-publisher that replays the 0.39.5 400 body until npm "serves" the
 * version. The sleep is compressed 1000x in the harness only; the stub counts
 * attempts, so the assertion is about how many attempts the loop makes.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/mcp/test/audit -> repo root
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const RELEASE_YML = join(REPO_ROOT, ".github", "workflows", "release.yml");

/** Worst npm propagation delay observed on the releases listed above. */
const WORST_OBSERVED_PROPAGATION_SECONDS = 287;

/** Lift the retry loop out of the `Publish` step of `publish-mcp-registry`. */
function extractPublishLoop(): { script: string; sleepSeconds: number } {
  const yml = readFileSync(RELEASE_YML, "utf8");
  const match = yml.match(
    /^( +)(set -euo pipefail\n(?:\1.*\n|\n)*?\1.*\.\/mcp-publisher publish packages\/mcp\/server\.json.*\n(?:\1.*\n|\n)*?\1exit 1)$/m,
  );
  if (!match) throw new Error("could not find the registry publish loop in release.yml");
  const indent = match[1];
  const script = match[2]
    .split("\n")
    .map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line))
    .join("\n");
  if (!script.includes("./mcp-publisher publish packages/mcp/server.json")) {
    throw new Error("extracted block is not the registry publish loop");
  }
  const sleep = script.match(/sleep (\d+)/);
  if (!sleep) throw new Error("publish loop has no sleep");
  return { script, sleepSeconds: Number(sleep[1]) };
}

/**
 * Run the loop against a stub publisher that 404s until `readyOnAttempt`.
 * Returns the exit code and how many attempts the loop made.
 */
function runLoop(script: string, readyOnAttempt: number): { code: number; attempts: number } {
  const dir = mkdtempSync(join(tmpdir(), "mcp-registry-retry-"));
  try {
    const counter = join(dir, "attempts");
    writeFileSync(counter, "0");
    writeFileSync(
      join(dir, "mcp-publisher"),
      [
        "#!/usr/bin/env bash",
        `n=$(( $(cat "${counter}") + 1 ))`,
        `echo "$n" > "${counter}"`,
        'echo "Publishing to https://registry.modelcontextprotocol.io..."',
        `if [ "$n" -ge ${readyOnAttempt} ]; then`,
        '  echo "✓ Successfully published"',
        "  exit 0",
        "fi",
        `echo "Error: publish failed: server returned status 400: {\\"title\\":\\"Bad Request\\",\\"status\\":400,\\"detail\\":\\"Failed to publish server\\",\\"errors\\":[{\\"message\\":\\"registry validation failed for package 0 (@leadbay/mcp): NPM package '@leadbay/mcp' exists, but version '0.39.5' was not found (status: 404). A newly published release can take a moment to appear on the registry. Wait and retry, or publish version '0.39.5' before registering it\\"}]}" >&2`,
        "exit 1",
        "",
      ].join("\n"),
    );
    chmodSync(join(dir, "mcp-publisher"), 0o755);
    // 1000x time compression: the loop's own sleep is the thing under test, so
    // only its duration is scaled, never the number of attempts.
    const compressed = script.replace(/sleep (\d+)/, (_m, s) => `sleep ${Number(s) / 1000}`);
    writeFileSync(join(dir, "loop.sh"), compressed);
    let code = 0;
    try {
      execFileSync("bash", ["loop.sh"], { cwd: dir, stdio: "pipe" });
    } catch (err) {
      code = (err as { status?: number }).status ?? 1;
    }
    return { code, attempts: Number(readFileSync(counter, "utf8").trim()) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("audit: MCP Registry publish outlasts npm propagation", () => {
  const { script, sleepSeconds } = extractPublishLoop();

  it("registers the version when npm serves it after the worst observed delay", () => {
    // 287s of 404s at one attempt per `sleepSeconds` => npm is ready here.
    const readyOnAttempt = Math.ceil(WORST_OBSERVED_PROPAGATION_SECONDS / sleepSeconds) + 1;
    const { code } = runLoop(script, readyOnAttempt);
    expect(code).toBe(0);
  });

  it("gives up rather than looping forever once npm is clearly not coming", () => {
    const { code, attempts } = runLoop(script, 10_000);
    expect(code).toBe(1);
    expect(attempts * sleepSeconds).toBeLessThanOrEqual(20 * 60);
  });

  it("publishes on the first attempt when npm already serves the version", () => {
    const { code, attempts } = runLoop(script, 1);
    expect(code).toBe(0);
    expect(attempts).toBe(1);
  });
});
