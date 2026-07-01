# Eval scenario — `leadbay_pull_leads` render order

Guards the issue #3832 fix. Authored to the scenario shape in `../../README.md`
(§"Adding a scenario") and fixture-complete — it runs as soon as the
scenario-execution glue (`helpers/run-eval.ts`, `setupScenarioFixtures`,
`runScenarioEval`, `vitest.eval.config.ts`) lands. That glue does not exist on
this branch yet, so there is intentionally **no `prompts/*.eval.ts` wiring
file** — adding one would import a module that doesn't exist and break the
build. Wire it up like this once the runner is in:

```ts
// prompts/leadbay_daily_check_in.eval.ts
import { runScenarioEval, setupScenarioFixtures } from "../helpers/run-eval.js";
import { SCENARIO as RENDERS_IN_TOOL_ORDER } from "../scenarios/pull-leads-order/renders-in-tool-order.scenario.js";

for (const s of [RENDERS_IN_TOOL_ORDER]) {
  describe(`eval: ${s.prompt} — ${s.name}`, () => {
    setupScenarioFixtures(s);
    it(s.name, async () => { await runScenarioEval({ scenario: s }); });
  });
}
```

| Scenario | Failure mode it catches |
|---|---|
| `renders-in-tool-order` | **Wrong render order.** The wishlist endpoint already returns leads in the UI Discover order (`LeadSort.DEFAULT` = `NEW_TODAY DESC, STATUS ASC, SCORE DESC`). The old RENDERING block told the agent to re-sort the table by `score` desc, which dropped the `NEW_TODAY`/`STATUS` primary keys and diverged from the UI. The fixture returns a new-today lead with a *lower* score ahead of an older *higher*-score lead; the agent must render them in that returned order (new lead first), NOT float the higher-score lead to the top. |
