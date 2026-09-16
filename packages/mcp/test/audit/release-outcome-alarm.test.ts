/**
 * Audit: a release that reaches only some of its surfaces files an issue.
 *
 * mcp-v0.39.6 was tagged on 16 September 2026, lost `npm publish` to a
 * transient 404, and left no signal anywhere. `Publish to MCP Registry`
 * was SKIPPED rather than failed, because it `needs: publish-mcp`, and a
 * skipped job reports nothing. The run itself was red, but `auto-tag.yml`
 * dispatches `release.yml` as github-actions[bot], so GitHub's run-failure
 * mail went to a bot. npm ran 0.39.5, 0.39.7, 0.39.8, 0.39.9 with no
 * 0.39.6, no GitHub Release and no release notes (product#4160).
 *
 * This test lifts the `release-outcome` step verbatim out of release.yml
 * and runs it against a stub `gh`, so the assertions are about what the
 * workflow actually does with each pair of job results.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/mcp/test/audit -> repo root
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const RELEASE_YML = join(REPO_ROOT, ".github", "workflows", "release.yml");

const STEP_NAME = "Open an issue when a surface is missing";
const TAG = "mcp-v0.39.6";

/** Lift the `run:` block of the alarm step out of release.yml. */
function extractAlarmScript(): string {
  const lines = readFileSync(RELEASE_YML, "utf8").split("\n");
  const stepAt = lines.findIndex((l) => l.trim() === `- name: ${STEP_NAME}`);
  if (stepAt === -1) throw new Error(`release.yml has no step named "${STEP_NAME}"`);
  const runAt = lines.findIndex((l, i) => i > stepAt && l.trim() === "run: |");
  if (runAt === -1) throw new Error("the alarm step has no `run: |` block");
  const indent = " ".repeat(lines[runAt].length - lines[runAt].trimStart().length + 2);
  const body: string[] = [];
  for (const line of lines.slice(runAt + 1)) {
    if (line.trim() !== "" && !line.startsWith(indent)) break;
    body.push(line.startsWith(indent) ? line.slice(indent.length) : line);
  }
  const script = body.join("\n");
  if (!script.includes("gh issue create")) throw new Error("extracted block is not the alarm");
  return script;
}

type Run = { code: number; ghCalls: string[]; issueBody: string | null; stdout: string };

/** Run the alarm with the given job results and a stub `gh`. */
function runAlarm(
  script: string,
  results: { npm: string; registry: string },
  openIssueTitles: string[] = [],
): Run {
  const dir = mkdtempSync(join(tmpdir(), "release-outcome-"));
  try {
    const calls = join(dir, "gh-calls");
    const issueBody = join(dir, "issue-body");
    writeFileSync(calls, "");
    writeFileSync(
      join(dir, "gh"),
      [
        "#!/usr/bin/env bash",
        `echo "$*" >> "${calls}"`,
        'if [ "$1 $2" = "issue list" ]; then',
        ...openIssueTitles.map((t) => `  echo ${JSON.stringify(t)}`),
        "  exit 0",
        "fi",
        'if [ "$1 $2" = "issue create" ]; then',
        "  while [ $# -gt 0 ]; do",
        '    if [ "$1" = "--body" ]; then',
        `      printf '%s' "$2" > "${issueBody}"`,
        "    fi",
        "    shift",
        "  done",
        "  exit 0",
        "fi",
        "exit 0",
        "",
      ].join("\n"),
    );
    chmodSync(join(dir, "gh"), 0o755);
    writeFileSync(join(dir, "alarm.sh"), script);
    let code = 0;
    let stdout = "";
    try {
      stdout = execFileSync("bash", ["alarm.sh"], {
        cwd: dir,
        stdio: "pipe",
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          GITHUB_REF: `refs/tags/${TAG}`,
          GITHUB_SERVER_URL: "https://github.com",
          GITHUB_REPOSITORY: "leadbay/mcp",
          GITHUB_RUN_ID: "35126228474",
          NPM_RESULT: results.npm,
          REGISTRY_RESULT: results.registry,
        },
      });
    } catch (err) {
      const e = err as { status?: number; stdout?: string };
      code = e.status ?? 1;
      stdout = e.stdout ?? "";
    }
    return {
      code,
      ghCalls: readFileSync(calls, "utf8").split("\n").filter(Boolean),
      issueBody: existsSync(issueBody) ? readFileSync(issueBody, "utf8") : null,
      stdout,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("audit: a half-shipped release files an issue", () => {
  const script = extractAlarmScript();

  it("says nothing when every surface was reached", () => {
    const run = runAlarm(script, { npm: "success", registry: "success" });
    expect(run.code).toBe(0);
    expect(run.ghCalls).toHaveLength(0);
  });

  it("files an issue on the mcp-v0.39.6 shape: npm failed, registry skipped", () => {
    const run = runAlarm(script, { npm: "failure", registry: "skipped" });
    expect(run.code).toBe(1);
    expect(run.ghCalls.some((c) => c.startsWith("issue create"))).toBe(true);
    expect(run.issueBody).toContain(TAG);
    expect(run.issueBody).toContain("| npm, GitHub Release, .dxt/.mcpb | publish-mcp | failure |");
    expect(run.issueBody).toContain("| MCP Registry | publish-mcp-registry | skipped |");
    expect(run.issueBody).toContain(
      "https://github.com/leadbay/mcp/actions/runs/35126228474",
    );
  });

  it("files an issue when npm published but the registry did not", () => {
    const run = runAlarm(script, { npm: "success", registry: "failure" });
    expect(run.code).toBe(1);
    expect(run.ghCalls.some((c) => c.startsWith("issue create"))).toBe(true);
  });

  it("does not file a second issue when one already names the tag", () => {
    const run = runAlarm(script, { npm: "failure", registry: "skipped" }, [
      `Release ${TAG} did not reach every surface`,
    ]);
    expect(run.code).toBe(1);
    expect(run.ghCalls.some((c) => c.startsWith("issue create"))).toBe(false);
  });

  it("tells the reader not to re-publish an older version", () => {
    const run = runAlarm(script, { npm: "failure", registry: "skipped" });
    expect(run.issueBody).toContain("--tag latest");
  });
});
