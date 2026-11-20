/**
 * Audit: npm only ever receives a tarball that was launched and answered an
 * MCP handshake first.
 *
 * The installers write `npx … @leadbay/mcp@latest` into every client config,
 * so each restart runs whatever `latest` points to, with the user's token in
 * its environment. One broken publish therefore reaches every seat at once.
 * The release workflow packs the tarball, runs scripts/smoke-tarball.mjs on
 * it, and publishes that same file. These assertions keep that order from
 * being lost in a later edit of release.yml.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, "..", "..");
const REPO_ROOT = join(PKG_ROOT, "..", "..");
const RELEASE_YML = readFileSync(join(REPO_ROOT, ".github", "workflows", "release.yml"), "utf8");

/** The `run: |` block of the `Publish` step in the publish-mcp job. */
function publishScript(): string {
  const lines = RELEASE_YML.split("\n");
  // publish-mcp comes before publish-mcp-registry, so the first `Publish` step is npm's.
  const stepAt = lines.findIndex((l) => l.trim() === "- name: Publish");
  if (stepAt === -1) throw new Error("release.yml has no Publish step in publish-mcp");
  const runAt = lines.findIndex((l, i) => i > stepAt && l.trim() === "run: |");
  const indent = " ".repeat(lines[runAt].length - lines[runAt].trimStart().length + 2);
  const body: string[] = [];
  for (const line of lines.slice(runAt + 1)) {
    if (line.trim() !== "" && !line.startsWith(indent)) break;
    body.push(line);
  }
  return body.join("\n");
}

describe("release.yml publishes only a smoke-tested tarball", () => {
  const script = publishScript();
  const live = script.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");

  it("the smoke script exists and is not shipped in the tarball", () => {
    expect(existsSync(join(PKG_ROOT, "scripts", "smoke-tarball.mjs"))).toBe(true);
    const files: string[] = JSON.parse(readFileSync(join(PKG_ROOT, "package.json"), "utf8")).files;
    expect(files.some((f) => f.startsWith("scripts"))).toBe(false);
  });

  it("runs the smoke test on the packed tarball before any publish", () => {
    const smokeAt = live.indexOf('node scripts/smoke-tarball.mjs "$TGZ" "$VERSION"');
    expect(smokeAt).toBeGreaterThan(-1);
    expect(live.indexOf("npm pack")).toBeGreaterThan(-1);
    expect(live.indexOf("npm pack")).toBeLessThan(smokeAt);
    const publishes = [...live.matchAll(/npm publish[^\n]*/g)];
    expect(publishes.length).toBeGreaterThan(0);
    for (const p of publishes) {
      expect(p.index!).toBeGreaterThan(smokeAt);
      // The published file is the one that was smoke-tested, not a re-pack.
      expect(p[0]).toContain('npm publish "$TGZ"');
      expect(p[0]).toContain("--provenance");
    }
  });

  it("still typechecks, since a tarball publish skips prepublishOnly", () => {
    expect(RELEASE_YML).toMatch(/run: pnpm -r typecheck/);
  });
});
