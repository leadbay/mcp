# @leadbay/promptforge

Build-time pipeline: assemble `.md.tmpl` sources into the generated artifacts
consumed by `@leadbay/core`, `@leadbay/mcp`, and the Claude Code plugin.

One source of truth per prompt — front-matter (validated by Zod) + body with
snippet includes (`{{include:gates/stop-and-wait}}`) and structured-argument
placeholders (`{{arg:NAME}}`). The CLI fans the same source out to multiple
emit targets so each consumer reads what it needs in the shape it needs.

## Emit targets

| Target | Path | Consumer |
| --- | --- | --- |
| MCP prompt module | `packages/mcp/src/prompts.generated.ts` | The MCP server's `prompts/list` + `prompts/get` handlers. Exports one `string` per prompt, a `PROMPT_META` record (descriptions + arguments + expected calls + failure modes), and a `PROMPT_CATALOG_HEADER` / `PROMPT_CATALOG_BULLETS` / `PROMPT_CATALOG_INSTRUCTIONS` triple. |
| Tool description module | `packages/core/src/tool-descriptions.generated.ts` | Per-tool descriptions imported by the tool registry. |
| Claude Code skills | `.claude-plugin/plugins/leadbay/skills/<name>/SKILL.md` | Auto-discovered by the Leadbay Claude Code plugin. One skill per prompt; `{{arg:NAME}}` placeholders are rewritten in place as natural-language extraction instructions because skills have no structured-argument system. |

The `PROMPT_CATALOG_*` exports exist so the MCP server's `initialize`
`instructions` payload advertises the prompt set to clients (Cowork is the
prototypical case) that don't render the `prompts/list` catalog in their UI.
The server splices `PROMPT_CATALOG_BULLETS` into its dynamic per-tool
guidance and filters bullets whose downstream tools aren't exposed (iter-12
invariant: never name a tool the agent can't call).

## Commands

| Command | What it does |
| --- | --- |
| `pnpm prompts:build` | Assemble + emit. Writes only files whose content changed. |
| `pnpm prompts:check` | Re-assemble and diff against disk. Exits non-zero if any emit target is stale; called from `pnpm test`. |
| `pnpm prompts:approve-drift <name>` | Records a snapshot-drift approval for the freshness test suite (see `packages/mcp/test/audit/`). |

## Adding a prompt

1. Drop `packages/promptforge/prompts/<name>.md.tmpl` in. Front-matter must
   declare `name`, `kind: prompt`, `short_description`, and any
   `arguments`. If the prompt calls mutating tools, declare at least three
   `failure_modes`.
2. Run `pnpm prompts:build`. The three targets above pick up the new
   prompt automatically; no other file needs editing.
3. Wire the runtime renderer in `packages/mcp/src/prompts.ts` if the prompt
   takes arguments (the renderer substitutes `{{arg:...}}` at `prompts/get`
   time — this is the one piece of glue that does not live in
   promptforge).
