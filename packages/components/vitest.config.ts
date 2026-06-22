import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The runtime is DOM-driven (delegated listeners, data-lb-* attributes,
    // CustomEvents). jsdom gives us a real document to fire clicks against.
    environment: "jsdom",
    include: ["test/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
  },
});
