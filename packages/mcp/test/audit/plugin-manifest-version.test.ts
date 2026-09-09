/**
 * The Claude plugin manifest must launch a server that has the tools its
 * skills call.
 *
 * `.claude-plugin/plugins/leadbay/.claude-plugin/plugin.json` pins the npx
 * package a marketplace install runs. Nothing keeps it in step with the
 * release: `pr-sync-on-release` renumbers
 * `packages/mcp/{package.json,server.json}` and does not know this file
 * exists, so it sat at 0.29 while main shipped 0.36 — seven releases stale and
 * silent, because until now every shipped skill only called tools that already
 * existed in 0.29.
 *
 * `leadbay_new_leads` is the first skill that does not: it calls
 * `leadbay_find_new_leads`, `leadbay_qualify_leads` and
 * `leadbay_lead_job_status`, none of which exist before 0.37. A marketplace
 * install would auto-trigger the skill and fail on its first tool call.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const PLUGIN_JSON = join(
  REPO_ROOT,
  ".claude-plugin/plugins/leadbay/.claude-plugin/plugin.json",
);
const SKILLS_DIR = join(REPO_ROOT, ".claude-plugin/plugins/leadbay/skills");

const shipped = JSON.parse(
  readFileSync(join(REPO_ROOT, "packages/mcp/package.json"), "utf8"),
).version as string;
const manifestRaw = readFileSync(PLUGIN_JSON, "utf8");
const manifest = JSON.parse(manifestRaw);

describe("audit: the plugin manifest tracks the shipped server", () => {
  it("declares the version this release publishes", () => {
    expect(manifest.version, "plugin.json version is stale").toBe(shipped);
  });

  it("pins an npx package that contains the tools the skills call", () => {
    // The pin is a minor line (`@leadbay/mcp@0.37`), so it must match the
    // shipped major.minor or a marketplace install resolves an older server.
    const pins = manifestRaw.match(/--package=@leadbay\/mcp@([\d.]+)/g) ?? [];
    expect(pins.length, "no @leadbay/mcp pin found in plugin.json").toBeGreaterThan(0);
    const wantMinor = shipped.split(".").slice(0, 2).join(".");
    for (const pin of pins) {
      expect(pin, `${pin} does not track ${shipped}`).toBe(
        `--package=@leadbay/mcp@${wantMinor}`,
      );
    }
  });

  it("ships a skill directory for every skill the manifest can auto-trigger", () => {
    // Guards the fixture: if the skills stopped shipping, the two cases above
    // would pass over a manifest nothing depends on.
    const skills = readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    expect(skills.length).toBeGreaterThan(0);
    expect(skills).toContain("leadbay_new_leads");
  });
});
