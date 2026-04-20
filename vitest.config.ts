import { defineConfig } from "vitest/config";

// Default run: unit + contract + sanity (no network).
// Smoke tests live under test/smoke/ and are run via `npm run test:smoke`.
// They are excluded here and re-included on the CLI for the smoke script.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    exclude: ["test/smoke/**", "node_modules", "dist"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/types.ts"],
      reporter: ["text", "html"],
    },
  },
});
