import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const INCLUDE_PATTERN = /\{\{include:([a-z0-9_\-/]+)\}\}/g;
const MAX_DEPTH = 8;

export class SnippetError extends Error {
  constructor(message: string, public readonly sourcePath: string) {
    super(`${sourcePath}: ${message}`);
    this.name = "SnippetError";
  }
}

export interface ResolveOptions {
  snippetsRoot: string;
  sourcePath: string;
}

export function resolveSnippets(body: string, opts: ResolveOptions): string {
  return resolveRecursive(body, opts.snippetsRoot, opts.sourcePath, [], 0);
}

function resolveRecursive(
  body: string,
  snippetsRoot: string,
  sourcePath: string,
  stack: string[],
  depth: number,
): string {
  if (depth > MAX_DEPTH) {
    throw new SnippetError(
      `snippet inclusion exceeded max depth ${MAX_DEPTH}; chain: ${stack.join(" -> ")}`,
      sourcePath,
    );
  }
  return body.replace(INCLUDE_PATTERN, (_match, snippetName: string) => {
    if (stack.includes(snippetName)) {
      throw new SnippetError(
        `snippet cycle detected: ${[...stack, snippetName].join(" -> ")}`,
        sourcePath,
      );
    }
    const path = join(snippetsRoot, `${snippetName}.md`);
    if (!existsSync(path)) {
      throw new SnippetError(
        `unknown snippet "${snippetName}" (looked for ${path})`,
        sourcePath,
      );
    }
    const content = readFileSync(path, "utf8");
    return resolveRecursive(
      content,
      snippetsRoot,
      sourcePath,
      [...stack, snippetName],
      depth + 1,
    );
  });
}

export function listSnippetsReferenced(body: string): string[] {
  const set = new Set<string>();
  for (const match of body.matchAll(INCLUDE_PATTERN)) {
    set.add(match[1]);
  }
  return [...set];
}
