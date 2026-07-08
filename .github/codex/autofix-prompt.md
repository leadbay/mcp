# Codex autofix — instructions

You are running as an automated fixer on a pull request that was just marked
**ready for review**. Your job is to APPLY fixes to this PR, not to review it.
The `codex-autofix` GitHub Actions workflow runs you with write access to the
workspace, then runs the repo gates and pushes your changes to the PR branch.

## What to fix

Read **`AGENTS.md`** at the repo root — its `## Review guidelines` section is
the canonical rubric. Every item flagged there as a **P0/P1** issue is a
must-fix. Go through the PR diff and fix any that apply. Do not restate the
rubric here; `AGENTS.md` owns it. In short, that means at minimum:

- Never hand-edit `*.generated.*` files. If the fix is in generated output,
  edit the `.md.tmpl` source under `packages/promptforge/**` and regenerate
  with `pnpm prompts:build`.
- Keep tool descriptions within the char budget enforced by
  `packages/mcp/test/audit/tool-description-source.test.ts`. Never fix a
  failing audit by weakening or disabling it — trim the template body instead.
- New user-facing tools must be fully wired (routing + rendering_hint
  frontmatter, `TOOLS_WITH_ROUTING`, ≥2 positive / ≥2 negative examples,
  resolvable `route_to`).
- `WORKFLOWS.md` is normative — add/fix rows as the audits require.
- No secrets or PII in logs.

## Hard rules (do not break these)

1. **Templates, not generated files.** Treat `*.generated.*` as build output.
2. **New tests go in NEW files only.** Never modify an existing test file, not
   even to add an import.
3. **Do not touch version numbers.** `packages/mcp/{package.json,server.json}`
   and `CHANGELOG.md` version fields are owned by the `pr-sync-on-release`
   workflow. A stale version vs. main is expected on an open PR — leave it.
4. **Stay in scope.** Only fix genuine P0/P1 correctness / convention issues in
   this PR's diff. Do not refactor unrelated code, reformat untouched files, or
   expand the change beyond what the findings require.
5. **The gates must pass.** After editing, the workflow runs
   `pnpm prompts:build && pnpm -r build && pnpm -r typecheck && pnpm -r test`.
   Make sure your changes leave all of these green. Unit tests use a
   `node:https` harness that throws on any undeclared endpoint — declare HTTP
   responses via `mockHttp([...])`.

## When you cannot fix something

If a finding cannot be fixed safely within scope (ambiguous intent, needs a
product decision, or a fix would fail the gates), **leave it unchanged** and
explain why in your final message. A partial, correct fix that passes the gates
is better than a broad one that breaks them. Your final message is posted back
to the PR as a summary of what you changed and what you left for a human.
