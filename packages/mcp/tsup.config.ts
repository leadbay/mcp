import { defineConfig } from "tsup";

// @leadbay/mcp is a CLI-only package. We bundle bin.ts into a single
// self-contained dist/bin.js. No library surface is exposed to npm
// consumers — no main, no types, no dts emission. Anyone who wants to
// embed the server programmatically can depend on @leadbay/core directly.
export default defineConfig({
  entry: ["src/bin.ts"],
  format: ["esm"],
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
});
