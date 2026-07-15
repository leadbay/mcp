# Eval scenarios — `uncrawled` is pending, not failed (issue #3858)

Two scenarios guarding the issue #3858 fix. Both are authored to the scenario
shape in `../../README.md` (§"Adding a scenario") and are fixture-complete —
they run as soon as the scenario-execution glue (`helpers/run-eval.ts`,
`setupScenarioFixtures`, `runScenarioEval`, `vitest.eval.config.ts`) lands, or
via the `/eval` skill runner. That vitest glue does not exist on this branch,
so there is intentionally **no `prompts/*.eval.ts` wiring file** — adding one
would import a module that doesn't exist and break the build. Wire them up like
this once the runner is in:

```ts
// prompts/leadbay_import_file.eval.ts
import { runScenarioEval, setupScenarioFixtures } from "../helpers/run-eval.js";
import { SCENARIO as PENDING } from "../scenarios/import-uncrawled/treats-uncrawled-as-pending.scenario.js";
import { SCENARIO as ALL_UNCRAWLED } from "../scenarios/import-uncrawled/all-uncrawled-still-reassures.scenario.js";

for (const s of [PENDING, ALL_UNCRAWLED]) {
  describe(`eval: ${s.prompt} — ${s.name}`, () => {
    setupScenarioFixtures(s);
    it(s.name, async () => { await runScenarioEval({ scenario: s }); });
  });
}
```

| Scenario | Failure mode it catches |
|---|---|
| `treats-uncrawled-as-pending` | **Mislabel.** Import returns a mix of matched + `uncrawled` rows (real corporate domains). The agent must report matched leads as imported and the `uncrawled` rows as PENDING a background crawl (re-check via `leadbay_import_status`) — never as failed / rejected / a backend problem / bad websites (the original #3858 failure). |
| `all-uncrawled-still-reassures` | **Boundary.** The whole batch comes back `uncrawled` (0 immediate matches) — the exact case that spooked the reporter. The agent must stay reassuring and actionable (pending late-crawl, re-check later) and must not declare the import failed or tell the user to distrust the batch. |

## Why this is a prompt fix, not a backend fix

`leadbay/product#3858`: `uncrawled` means Leadbay's crawler hasn't indexed that
domain yet. The import completes immediately; the backend then crawls the
domain and adds the lead asynchronously (a *late import*). milstan confirmed
this is by-design, not a bug. The bug was the MCP agent parroting the shared
`import-result` rendering snippet, which folded `uncrawled` under "M failed".
The fix teaches the agent (via `snippets/rendering/uncrawled-status.md`, wired
into the import tool descriptions + `import-result` render block) that
`uncrawled` = pending, and stops the "failed" framing.
