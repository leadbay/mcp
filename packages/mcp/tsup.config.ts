import { defineConfig } from "tsup";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// @leadbay/mcp is a CLI-only package. We bundle bin.ts into a single
// self-contained dist/bin.js. No library surface is exposed to npm
// consumers — no main, no types, no dts emission. Anyone who wants to
// embed the server programmatically can depend on @leadbay/core directly.
export default defineConfig({
  entry: {
    bin: "src/bin.ts",
    "http-server": "src/http-server.ts",
    "installer-gui": "installer/installer-gui.ts",
    "installer-electron": "installer/installer-electron.ts",
  },
  format: ["esm"],
  // Keep bin.js as the real entrypoint. If tsup code-splits bin.ts into a
  // chunk, the import.meta.url entrypoint guard sees the chunk path and the
  // CLI silently exits.
  splitting: false,
  dts: false,
  outDir: "dist",
  clean: true,
  // @leadbay/core is a private workspace dep — bundle it so the published
  // tarball has no unresolvable workspace:* references.
  noExternal: ["@leadbay/core"],
  target: "es2022",
  banner: {
    js: "#!/usr/bin/env node",
  },
  define: {
    __LEADBAY_MCP_VERSION__: JSON.stringify(pkg.version),
  },
});
