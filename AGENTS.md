# AGENTS.md — leadbay/mcp

Guidance for AI agents (OpenAI Codex, etc.) working in this repo.

Full engineering conventions live in **[`CLAUDE.md`](CLAUDE.md)**; the
canonical map of user intent → MCP assets → tests is
**[`WORKFLOWS.md`](WORKFLOWS.md)**. Read those before making non-trivial
changes. This is a pnpm monorepo (pnpm 10, Node ≥22); `core` is the
shared library and `mcp` is the stdio server that exposes it.

## Review guidelines

Codex reads this section for automated PR reviews. Flag the following as
high-priority (P0/P1) issues:

- **Never hand-edit generated files.**
  `packages/core/src/tool-descriptions.generated.ts` and
  `packages/mcp/src/prompts.generated.ts` are emitted by
  `@leadbay/promptforge` from `.md.tmpl` sources under
  `packages/promptforge/{tool-descriptions,prompts,snippets}/`. Any diff
  that edits a `*.generated.*` file directly will be wiped on the next
  build — flag it and point to the template.

- **Do not re-introduce `Tool.ui` bindings or MCP-Apps iframe widgets.**
  The `Tool.ui` field was removed in 0.10.0-dev.12. Rendering is
  chat-native markdown plus the three host-native widgets only
  (`places_map_display_v0`, `message_compose_v1`, `ask_user_input_v0`).

- **Respect the tool-description char budget.** Composites cap at ~16k
  chars, hard cap 17k, enforced by
  `packages/mcp/test/audit/tool-description-source.test.ts`. Flag edits
  that risk the cap — and never "fix" a failing audit by disabling or
  weakening it; trim the template body instead.

- **New user-facing tools must be wired completely.** They must declare
  `routing` and `rendering_hint` frontmatter (plus `next_steps` when the
  tool has a NEXT STEPS table), be added to `TOOLS_WITH_ROUTING` in
  `packages/mcp/test/audit/routing-block.test.ts`, and carry ≥2 positive
  AND ≥2 negative routing examples. Every `route_to` anti-trigger must
  resolve to a registered tool name.

- **`WORKFLOWS.md` is normative.** A new user story needs a row, and
  every backtick-wrapped `leadbay_*` identifier must resolve to a
  registered tool/prompt/skill (checked by
  `packages/mcp/test/audit/workflows.test.ts`).

- **Tests.** `pnpm -r test` and `pnpm -r typecheck` must be green on
  every PR. New tests go in **new** files — do not modify existing test
  files. Flag unit tests that make real network calls: the `node:https`
  harness throws on any undeclared endpoint, so tests must declare their
  HTTP responses via `mockHttp([...])`.

- **Secrets & credentials.** Flag secrets or PII written to logs. Do not
  rotate the expendable test-account credentials defensively.
