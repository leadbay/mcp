// A tool declares its annotations twice: in the Tool object under
// packages/core/src/{tools,composite}/ and in its template's frontmatter. Only
// the first reaches the wire, so the second drifts silently — seven templates
// had, including `leadbay_create_topup_link` and `leadbay_open_billing_portal`
// claiming readOnlyHint:true for tools that mint a Stripe checkout URL.
//
// That matters beyond tidiness: readOnlyHint and destructiveHint are what the
// Anthropic Connectors Directory reads to decide whether Claude prompts before
// a call, and the template is what an author edits.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  compositeReadTools,
  compositeWriteTools,
  granularReadTools,
  granularWriteTools,
} from "@leadbay/core";

const TOOL_DIR = join(import.meta.dirname, "..", "tool-descriptions");
const HINTS = [
  "readOnlyHint",
  "destructiveHint",
  "idempotentHint",
  "openWorldHint",
] as const;

const byName = new Map(
  [
    ...compositeReadTools,
    ...compositeWriteTools,
    ...granularReadTools,
    ...granularWriteTools,
  ].map((t) => [t.name, t])
);

function templates(): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(TOOL_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const file of readdirSync(join(TOOL_DIR, entry.name))) {
      out.push(join(TOOL_DIR, entry.name, file));
    }
  }
  return out;
}

describe("template frontmatter annotations match the registered Tool", () => {
  const cases = templates().flatMap((path) => {
    const src = readFileSync(path, "utf8");
    const name = /^name:\s*(\S+)/m.exec(src)?.[1];
    const block = /^annotations:\n((?:\s{2}\w+:.*\n)+)/m.exec(src)?.[1];
    if (!name || !block || !byName.has(name)) return [];
    return [{ name, block }];
  });

  it("covers the templates that declare annotations", () => {
    expect(cases.length).toBeGreaterThan(50);
  });

  it.each(cases)("$name", ({ name, block }) => {
    const tool = byName.get(name)!;
    const declared = Object.fromEntries(
      [...block.matchAll(/^\s{2}(\w+):\s*(true|false)\s*$/gm)].map((m) => [
        m[1],
        m[2] === "true",
      ])
    );
    for (const hint of HINTS) {
      if (!(hint in declared)) continue;
      expect(declared[hint], `${name}.${hint}`).toBe(
        (tool.annotations as Record<string, unknown> | undefined)?.[hint]
      );
    }
  });
});
