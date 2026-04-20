import { defineConfig } from "vitest/config";

// Smoke-only config — used by `npm run test:smoke`. These tests hit the live
// Leadbay API and are opt-in (gated by LEADBAY_TEST_TOKEN env var).
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/smoke/**/*.test.ts"],
    testTimeout: 15_000,
  },
});
