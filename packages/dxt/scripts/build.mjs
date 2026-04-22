#!/usr/bin/env node
// Build the Leadbay .dxt bundle.
//
// Output: packages/dxt/dist/leadbay-<mcpVersion>.dxt
//
// The .dxt is a zip with:
//   - manifest.json                 (from manifest.template.json, version substituted)
//   - server/index.js               (esbuild bundle of packages/mcp/src/bin.ts,
//                                    plus a "stdio-entry.mjs"-style wrapper that
//                                    always runs the MCP server, never the CLI)
//   - icon.png                      (from packages/leadclaw/logo.png)
//   - README.md                     (from packages/mcp/README.md)
//
// Why bundle bin.ts? Its `isEntrypoint` guard already handles the dual CLI /
// server mode. When DXT invokes `node server/index.js`, process.argv[1] is
// server/index.js and no subcommand is passed → the server starts.
import { mkdirSync, writeFileSync, readFileSync, rmSync, createWriteStream, existsSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import archiver from "archiver";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DXT_DIR = dirname(__dirname);                          // packages/dxt
const REPO_ROOT = dirname(dirname(DXT_DIR));                 // <repo root>
const MCP_DIR = join(REPO_ROOT, "packages", "mcp");
const LEADCLAW_DIR = join(REPO_ROOT, "packages", "leadclaw");
const DIST_DIR = join(DXT_DIR, "dist");
const STAGE_DIR = join(DIST_DIR, "stage");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

async function main() {
  const mcpPkg = readJson(join(MCP_DIR, "package.json"));
  const version = mcpPkg.version;

  // Fresh staging.
  if (existsSync(DIST_DIR)) rmSync(DIST_DIR, { recursive: true, force: true });
  mkdirSync(join(STAGE_DIR, "server"), { recursive: true });

  // 1. Render manifest.
  const manifestTpl = readFileSync(join(DXT_DIR, "manifest.template.json"), "utf8");
  const manifest = manifestTpl.replaceAll("{{VERSION}}", version);
  // Validate it parses.
  JSON.parse(manifest);
  writeFileSync(join(STAGE_DIR, "manifest.json"), manifest, "utf8");

  // 2. Bundle bin.ts into a single server/index.js.
  //    - platform: node, format: esm (bin.ts uses top-level await + import.meta).
  //    - target: node22 (DXT ships Node 22+ in Claude Desktop).
  //    - External: nothing. DXT bundles are self-contained; we don't want the
  //      Claude Desktop runtime resolving our deps.
  //    - Define __LEADBAY_MCP_VERSION__ the same way tsup does.
  await build({
    entryPoints: [join(MCP_DIR, "src", "bin.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    outfile: join(STAGE_DIR, "server", "index.js"),
    external: [],
    define: {
      __LEADBAY_MCP_VERSION__: JSON.stringify(version),
    },
    banner: {
      js: "#!/usr/bin/env node",
    },
    logLevel: "info",
  });

  // 3. Assets.
  copyFileSync(join(LEADCLAW_DIR, "logo.png"), join(STAGE_DIR, "icon.png"));
  if (existsSync(join(MCP_DIR, "README.md"))) {
    copyFileSync(join(MCP_DIR, "README.md"), join(STAGE_DIR, "README.md"));
  }

  // 4. Zip.
  const dxtPath = join(DIST_DIR, `leadbay-${version}.dxt`);
  await new Promise((resolve, reject) => {
    const out = createWriteStream(dxtPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    out.on("close", resolve);
    out.on("error", reject);
    archive.on("error", reject);
    archive.pipe(out);
    archive.directory(STAGE_DIR, false);
    archive.finalize();
  });

  const { statSync } = await import("node:fs");
  const bytes = statSync(dxtPath).size;
  console.log(`\n✓ built ${dxtPath} (${(bytes / 1024).toFixed(1)} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
