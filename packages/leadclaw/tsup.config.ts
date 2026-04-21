import { defineConfig } from "tsup";

// @leadbay/core is a private workspace package; bundle it into dist/index.js
// so that the published tarball is self-contained (no workspace:* dep survives).
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  outDir: "dist",
  clean: true,
  noExternal: ["@leadbay/core"],
  target: "es2022",
});
