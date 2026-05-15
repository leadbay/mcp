import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

/**
 * Eval-tier vitest config — sequential execution by default (eng-review
 * Performance #1 decision). Real LLM calls share rate limits; parallel
 * runs cause 429s and noisy retries. Add a token-bucket helper only
 * after measured pain.
 */
export default defineConfig({
  define: {
    __LEADBAY_MCP_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    environment: "node",
    include: ["test/eval/**/*.eval.ts"],
    exclude: ["node_modules", "dist"],
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true, // strict sequential — one fork, one test at a time
      },
    },
    testTimeout: 600_000, // 10 minutes per scenario
  },
});
