import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  define: {
    __LEADBAY_MCP_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    exclude: ["test/smoke/**", "node_modules", "dist"],
  },
});
