/**
 * Audit: the committed generated modules carry no CR.
 *
 * The generators inline markdown verbatim into TS string literals, so a CRLF
 * checkout bakes `\r\n` ESCAPE SEQUENCES — two ordinary characters — into the
 * committed file. Git normalizes real CR bytes on commit but cannot touch those
 * escapes, so the file then differs from a fresh build on every LF machine and
 * rides a ~65 KB one-line diff into unrelated PRs (product#4044).
 *
 * Reads the blob at HEAD, not the working tree: CI runs `pnpm -r build` before
 * `pnpm -r test`, so a working-tree assertion would only re-measure the file the
 * build just wrote.
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/mcp/test/audit -> repo root
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");

const GENERATED = [
  "packages/core/src/artifact-runtime.generated.ts",
  "packages/core/src/tool-descriptions.generated.ts",
  "packages/mcp/src/prompts.generated.ts",
  "packages/mcp/src/server-instructions.generated.ts",
];

function blobAtHead(path: string): string {
  return execFileSync("git", ["cat-file", "-p", `HEAD:${path}`], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

describe("audit: generated modules use LF only", () => {
  for (const path of GENERATED) {
    it(`${path} has no CR bytes`, () => {
      const count = (blobAtHead(path).match(/\r/g) ?? []).length;
      expect(count, `${path}: ${count} CR bytes at HEAD`).toBe(0);
    });

    it(`${path} has no \\r escape sequences`, () => {
      const count = (blobAtHead(path).match(/\\r/g) ?? []).length;
      expect(
        count,
        `${path}: ${count} \\r escapes at HEAD — regenerate from an LF checkout`,
      ).toBe(0);
    });
  }
});
