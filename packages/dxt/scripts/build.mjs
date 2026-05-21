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
//   - icon.png                      (from packages/dxt/icon.png)
//   - README.md                     (from packages/mcp/README.md)
//
// Why bundle bin.ts? Its `isEntrypoint` guard already handles the dual CLI /
// server mode. When DXT invokes `node server/index.js`, process.argv[1] is
// server/index.js and no subcommand is passed → the server starts.
import { mkdirSync, writeFileSync, readFileSync, rmSync, createWriteStream, existsSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import archiver from "archiver";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DXT_DIR = dirname(__dirname);                          // packages/dxt
const REPO_ROOT = dirname(dirname(DXT_DIR));                 // <repo root>
const MCP_DIR = join(REPO_ROOT, "packages", "mcp");
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
      // esbuild leaves some CommonJS dependencies (notably Sentry /
      // OpenTelemetry) with dynamic require("perf_hooks") calls even in an
      // ESM bundle. Claude Desktop runs this file directly, so provide a
      // module-local require backed by Node's createRequire.
      js:
        "#!/usr/bin/env node\n" +
        "import { createRequire as __leadbayCreateRequire } from 'node:module';\n" +
        "const require = __leadbayCreateRequire(import.meta.url);",
    },
    logLevel: "info",
  });

  // 3. Assets.
  copyFileSync(join(DXT_DIR, "icon.png"), join(STAGE_DIR, "icon.png"));
  if (existsSync(join(MCP_DIR, "README.md"))) {
    copyFileSync(join(MCP_DIR, "README.md"), join(STAGE_DIR, "README.md"));
  }

  // 3a. Sanity check the staged server/index.js. esbuild escapes non-ASCII to
  // \uXXXX, so we look for both the literal and escaped forms. A previous
  // 0.9.1 bundle shipped without these strings because @leadbay/core was
  // compiled against a stale tool-descriptions.generated.ts — fail fast here
  // rather than ship a partial build.
  const indexJs = readFileSync(join(STAGE_DIR, "server", "index.js"), "utf8");
  const checks = [
    { label: "pull_leads RENDERING block", needles: ["RENDERING \\u2014 markdown table", "RENDERING — markdown table"] },
    { label: "NEXT STEPS block",           needles: ["NEXT STEPS \\u2014 after rendering", "NEXT STEPS — after rendering"] },
    { label: "AI booster-cap glyph (❖)",   needles: ["\\u2756", "❖"] },
    { label: "IRON LAW outcome-after-outreach", needles: ["IRON LAW \\u2014 OUTCOME AFTER OUTREACH", "IRON LAW — OUTCOME AFTER OUTREACH"] },
  ];
  const missing = checks.filter(({ needles }) => !needles.some((n) => indexJs.includes(n)));
  if (missing.length > 0) {
    console.error("\n✗ Bundle is missing required tool-description content:");
    for (const { label, needles } of missing) {
      console.error(`  - ${label}  (looked for: ${needles.map((n) => JSON.stringify(n)).join(" | ")})`);
    }
    console.error("\nLikely cause: @leadbay/core was compiled before @leadbay/promptforge re-rendered tool-descriptions.generated.ts.");
    console.error("Fix: pnpm --filter @leadbay/promptforge build && pnpm --filter @leadbay/core build, then rebuild.\n");
    process.exit(1);
  }
  const versionOut = execFileSync("node", [join(STAGE_DIR, "server", "index.js"), "--version"], {
    encoding: "utf8",
  }).trim();
  if (versionOut !== version) {
    console.error(`\n✗ Staged server --version returned ${JSON.stringify(versionOut)}; expected ${version}`);
    process.exit(1);
  }
  console.log("✓ Bundle sanity check passed (RENDERING + NEXT STEPS + ❖ + IRON LAW present)");
  console.log("✓ Staged server starts successfully");

  // 4. Zip.
  // iter-27: Anthropic renamed DXT → MCPB (Model Context Protocol Bundle)
  // for Claude Desktop. The bundle content is identical (same manifest + same
  // zip layout); only the filename / extension changed. Emit both for one
  // cycle so upgrade-path is gentle: clients still scanning for *.dxt keep
  // working; new clients matching *.mcpb pick up the bundle. The .dxt
  // filename can be retired in 0.7.0 once downstream clients adopt MCPB.
  const dxtPath = join(DIST_DIR, `leadbay-${version}.dxt`);
  const mcpbPath = join(DIST_DIR, `leadbay-${version}.mcpb`);
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

  // Copy verbatim — same content under the new extension. Faster + simpler
  // than re-zipping; identical bytes guarantees both filenames extract to
  // the same staging tree.
  copyFileSync(dxtPath, mcpbPath);

  const { statSync } = await import("node:fs");
  const bytes = statSync(dxtPath).size;
  console.log(`\n✓ built ${dxtPath} (${(bytes / 1024).toFixed(1)} KB)`);
  console.log(`✓ built ${mcpbPath} (identical content; new MCPB filename for Claude Desktop)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
