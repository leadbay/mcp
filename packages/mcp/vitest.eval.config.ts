import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

/**
 * Eval config — separate from vitest.config.ts on purpose.
 *
 * The unit suite (`test/**\/*.test.ts`) is hermetic and parallel. Evals are the
 * opposite: each one spawns the `claude` CLI, which spawns a real MCP server,
 * which makes real calls to the Leadbay API, and then shells out again for the
 * judge. They are slow, non-deterministic, cost money, and must not run in CI
 * or in `pnpm -r test`.
 *
 * The two configs never overlap: vitest.config.ts includes only `*.test.ts`,
 * this one only `*.eval.ts`, so neither picks up the other's files.
 *
 * SERIAL BY NECESSITY. Parallel sessions thrash the Leadbay API and the judge's
 * rate limits, and each session spawns processes that hold a session id. One at
 * a time is the only shape that produces trustworthy scores.
 */
export default defineConfig({
  define: {
    __LEADBAY_MCP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      // mission-match-judge.ts imports `@leadbay/promptforge` (for parseTemplate,
      // to read each prompt's rubric + failure_modes out of its .md.tmpl). That
      // package's `exports` points at dist/, but its `build` script runs the
      // prompt GENERATOR (`tsx src/cli.ts build`) — the actual `tsc` lives in a
      // separate `compile` script nothing in the pipeline calls, so dist/ has
      // never existed and the import fails to resolve.
      //
      // Aliasing to source is the right fix here rather than adding a compile
      // step: vitest transforms the TS directly, evals stay a single command,
      // and the judge always reads the templates as they are on disk.
      "@leadbay/promptforge": resolve(__dirname, "../promptforge/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["test/eval/**/*.eval.ts"],
    exclude: ["node_modules", "dist"],
    pool: "threads",
    poolOptions: { threads: { singleThread: true } },
    fileParallelism: false,
    // A multi-turn live session plus a judge pass runs into minutes, not
    // seconds. The default 5s timeout would fail every eval on the clock.
    testTimeout: 15 * 60_000,
    hookTimeout: 2 * 60_000,
    reporters: ["verbose"],
  },
});
