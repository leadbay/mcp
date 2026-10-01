/**
 * product#4237: every argument key we teach must be one the tool accepts.
 *
 * Sibling tools spell the lead id three ways (`leadId`, `lead_id`,
 * `lead_ids`), and the 0.41.0 artifact guide taught
 * `leadbay_set_prospecting_action({lead_id, …})` next to `leadId` tools. An
 * agent that copies a key from one place onto the wrong tool gets rejected.
 * The dispatcher now rejects undeclared keys by name, so a key taught here
 * that the schema does not declare would fail on every call that follows it.
 *
 * Scans what an agent or an artifact actually reads or runs:
 *   - every served tool description, the server instructions and the prompts,
 *   - the artifact guide (packages/components/src/usage-guide.md),
 *   - the artifact runtime and page templates, whose calls carry real args.
 * For each `leadbay_x({…})`, `leadbay_x with {…}`, `call("leadbay_x", {…})`
 * and `tool: "leadbay_x", … args: …({…})`, every top-level key must be in the
 * tool's served inputSchema.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { LeadbayClient } from "@leadbay/core";
import { buildServer } from "../../src/server.js";
import * as INSTRUCTIONS from "../../src/server-instructions.generated.js";
import * as PROMPTS from "../../src/prompts.generated.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const COMPONENTS = fileURLToPath(new URL("../../../components/src/", import.meta.url));

async function servedTools() {
  const server = buildServer(new LeadbayClient("https://api-us.leadbay.app", "u.t", "us"), {
    includeWrite: true,
    includeAdvanced: true,
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "audit", version: "0" }, {});
  await Promise.all([server.connect(b), client.connect(a)]);
  return (await client.listTools()).tools;
}

// Index of the brace that closes the one at `open`, skipping strings.
function closing(src: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Top-level keys of the object literal whose `{` is at `open`. Keys inside a
// spread (`...(x ? { lensId } : {})`) count: they are sent too. Entries that
// are prose (`city / set_filter`, `…`) are not keys and are skipped.
function topKeys(src: string, open: number): string[] {
  const end = closing(src, open);
  if (end < 0) return [];
  const body = src.slice(open + 1, end);
  const entries: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if ("{[(".includes(c)) depth++;
    else if ("}])".includes(c)) depth--;
    else if (c === "," && depth === 0) {
      entries.push(body.slice(start, i));
      start = i + 1;
    }
  }
  entries.push(body.slice(start));
  const keys: string[] = [];
  for (const raw of entries) {
    const e = raw.replace(/\/\/[^\n]*/g, "").trim();
    if (e.startsWith("...")) {
      for (let i = e.indexOf("{"); i >= 0; ) {
        keys.push(...topKeys(e, i));
        const j = closing(e, i);
        i = j < 0 ? -1 : e.indexOf("{", j);
      }
      continue;
    }
    const m = e.match(/^["']?([A-Za-z_$][\w$]*)["']?\??(?:\s*:|\s*$|\s+\()/);
    if (m) keys.push(m[1]);
  }
  return keys;
}

type Taught = { source: string; tool: string; key: string };

function scan(source: string, text: string): Taught[] {
  const out: Taught[] = [];
  const patterns = [
    /(leadbay_[a-z_]+)`?\s*(?:\(\s*`?|with\s+`?)\{/g,
    /call\(\s*["'](leadbay_[a-z_]+)["']\s*,\s*\{/g,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const open = m.index! + m[0].length - 1;
      for (const key of topKeys(text, open)) out.push({ source, tool: m[1], key });
    }
  }
  // new Action({ tool: "leadbay_x", …, args: () => ({…}) | args: {…} | args: () => { … return {…} } })
  for (const m of text.matchAll(/tool:\s*["'](leadbay_[a-z_]+)["']/g)) {
    const at = text.indexOf("args:", m.index!);
    if (at < 0 || at - m.index! > 1500) continue;
    const head = text.slice(at, at + 200);
    let open = -1;
    const fnBody = head.match(/^args:\s*\([^)]*\)\s*=>\s*\{/);
    if (fnBody) {
      const ret = text.indexOf("return {", at);
      if (ret >= 0) open = ret + "return ".length;
    } else {
      open = text.indexOf("{", at);
    }
    if (open >= 0) for (const key of topKeys(text, open)) out.push({ source, tool: m[1], key });
  }
  return out;
}

describe("audit: every argument key we teach is one the tool accepts (product#4237)", () => {
  it("descriptions, instructions, prompts, the artifact guide and the artifact code", async () => {
    const tools = await servedTools();
    const schemas = new Map(
      tools.map((t) => [t.name, new Set(Object.keys((t.inputSchema as any).properties ?? {}))])
    );

    const taught: Taught[] = [];
    for (const t of tools) taught.push(...scan(`description of ${t.name}`, t.description ?? ""));
    for (const [k, v] of Object.entries(INSTRUCTIONS)) {
      if (typeof v === "string") taught.push(...scan(`server instructions ${k}`, v));
    }
    for (const [k, v] of Object.entries(PROMPTS)) {
      if (typeof v === "string") taught.push(...scan(`prompt ${k}`, v));
    }
    taught.push(...scan("usage-guide.md", readFileSync(join(COMPONENTS, "usage-guide.md"), "utf8")));
    taught.push(...scan("runtime.ts", readFileSync(join(COMPONENTS, "runtime.ts"), "utf8")));
    const templates = join(COMPONENTS, "templates");
    for (const dir of readdirSync(templates)) {
      const app = join(templates, dir, "app.js");
      if (existsSync(app)) taught.push(...scan(`templates/${dir}/app.js`, readFileSync(app, "utf8")));
    }

    // The scan must actually find the cases that motivated it.
    expect(taught.some((t) => t.tool === "leadbay_set_prospecting_action" && t.key === "lead_id")).toBe(true);
    expect(taught.some((t) => t.tool === "leadbay_add_note" && t.key === "leadId")).toBe(true);

    const wrong = taught
      .filter((t) => schemas.has(t.tool) && !schemas.get(t.tool)!.has(t.key))
      .map((t) => `${t.source}: ${t.tool} is taught \`${t.key}\`, which its schema does not declare`);
    expect([...new Set(wrong)]).toEqual([]);
  });
});
