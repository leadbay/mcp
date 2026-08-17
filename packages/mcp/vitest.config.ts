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
    env: {
      // Run the contract audits against the FULL registry. WORKFLOWS.md is a
      // map of what Leadbay can do, so `workflows.test.ts` asks "does every
      // leadbay_* name resolve to something that exists?" — a question about
      // the registry, not about one deployment's exposure. With the flag off,
      // the delivery tools are absent from the exported arrays and that audit
      // would read documented, registered tools as typos.
      //
      // Set here rather than by widening the audit's imports: the audit is an
      // established test file, and a rollout flag should not be able to make
      // WORKFLOWS.md look wrong. Tests that exercise the gate itself
      // (prompt-release-gate.test.ts, mcp-first-delivery-gate.test.ts) set and
      // delete the variable themselves, so they are unaffected by this default.
      LEADBAY_MCP_LEAD_DELIVERY: "1",
    },
  },
});
