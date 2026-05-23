#!/usr/bin/env node
// Build a STAGING .mcpb for testing OAuth login end-to-end against
// staging.leadbay.app / api-{us,fr}-staging.leadbay.app.
//
// Differs from scripts/build.mjs:
//   - `name` is "leadbay-staging" so the bundle can coexist with the prod
//     install in Claude Desktop's Extensions list.
//   - `display_name` is "Leadbay (Staging)" so the user can tell them apart.
//   - no token / region / backend URL config fields. The bundled server opts
//     into OAuth bootstrap, uses staging stargate to infer region, opens the
//     browser for consent, then persists the resulting token.
//   - Output file is `leadbay-staging-<version>.mcpb`.
//
// To use:
//   1. Build this bundle: pnpm --filter @leadbay/dxt run build:staging
//   2. Drag `packages/dxt/dist/leadbay-staging-<v>.mcpb` into Claude Desktop
//      → Settings → Extensions.
//   3. Save the extension settings. The server opens staging.leadbay.app for
//      OAuth on first launch.
import { mkdirSync, writeFileSync, readFileSync, rmSync, createWriteStream, existsSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import archiver from "archiver";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DXT_DIR = dirname(__dirname);
const REPO_ROOT = dirname(dirname(DXT_DIR));
const MCP_DIR = join(REPO_ROOT, "packages", "mcp");
const DIST_DIR = join(DXT_DIR, "dist");
const STAGE_DIR = join(DIST_DIR, "stage-staging");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

async function main() {
  const mcpPkg = readJson(join(MCP_DIR, "package.json"));
  const version = mcpPkg.version;

  if (existsSync(STAGE_DIR)) rmSync(STAGE_DIR, { recursive: true, force: true });
  mkdirSync(join(STAGE_DIR, "server"), { recursive: true });

  // Start from the prod manifest, then patch the staging-specific fields.
  const manifestTpl = readFileSync(join(DXT_DIR, "manifest.template.json"), "utf8");
  const manifest = JSON.parse(manifestTpl.replaceAll("{{VERSION}}", version));

  manifest.name = "leadbay-staging";
  manifest.display_name = "Leadbay (Staging)";
  manifest.description = "STAGING build - talks to staging.leadbay.app / api-{us,fr}-staging.leadbay.app. On first launch, the server opens your browser for OAuth and persists the token. No paste-the-token dance.";

  // Zero-config install: opt into startup OAuth and mark the auth environment
  // as staging. Token + region are resolved at server startup (OAuth flow on
  // first run, persisted credentials file thereafter).
  manifest.server.mcp_config.env = {
    LEADBAY_OAUTH_BOOTSTRAP: "1",
    LEADBAY_OAUTH_STAGING: "1",
    LEADBAY_ENV: "staging",
    // Keep write-tools toggle controllable.
    LEADBAY_MCP_WRITE: "${user_config.leadbay_mcp_write}",
  };

  // The only thing left for the user to decide is whether to keep write
  // tools on. Everything else is determined at OAuth time.
  manifest.user_config = {
    leadbay_mcp_write: manifest.user_config.leadbay_mcp_write,
  };

  writeFileSync(join(STAGE_DIR, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");

  // Same bundling as the prod build.
  await build({
    entryPoints: [join(MCP_DIR, "src", "bin.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    outfile: join(STAGE_DIR, "server", "index.js"),
    external: [],
    define: {
      __LEADBAY_MCP_VERSION__: JSON.stringify(`${version}-staging`),
    },
    banner: {
      js:
        "#!/usr/bin/env node\n" +
        "import { createRequire as __leadbayCreateRequire } from 'node:module';\n" +
        "const require = __leadbayCreateRequire(import.meta.url);",
    },
    logLevel: "info",
  });

  copyFileSync(join(DXT_DIR, "icon.png"), join(STAGE_DIR, "icon.png"));
  if (existsSync(join(MCP_DIR, "README.md"))) {
    copyFileSync(join(MCP_DIR, "README.md"), join(STAGE_DIR, "README.md"));
  }

  // Sanity: confirm the staged server starts and reports the staging tag.
  const versionOut = execFileSync("node", [join(STAGE_DIR, "server", "index.js"), "--version"], {
    encoding: "utf8",
  }).trim();
  if (!versionOut.startsWith(version)) {
    console.error(`\n✗ Staged server --version returned ${JSON.stringify(versionOut)}; expected to start with ${version}`);
    process.exit(1);
  }
  console.log(`✓ Staged server starts (reported: ${versionOut})`);

  const mcpbPath = join(DIST_DIR, `leadbay-staging-${version}.mcpb`);
  await new Promise((resolve, reject) => {
    const out = createWriteStream(mcpbPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    out.on("close", resolve);
    out.on("error", reject);
    archive.on("error", reject);
    archive.pipe(out);
    archive.directory(STAGE_DIR, false);
    archive.finalize();
  });

  const { statSync } = await import("node:fs");
  const bytes = statSync(mcpbPath).size;
  console.log(`\n✓ built ${mcpbPath} (${(bytes / 1024).toFixed(1)} KB)`);
  console.log(`\nNext steps:`);
  console.log(`  1. Drag ${mcpbPath} into Claude Desktop -> Settings -> Extensions.`);
  console.log(`  2. Save the extension settings. Only "Enable write tools" should be shown.`);
  console.log(`  3. Claude Desktop should launch the server, which opens staging OAuth in your browser.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
