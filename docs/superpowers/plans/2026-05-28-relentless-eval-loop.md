# Relentless Eval Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deliberately-failing workflow 2b eval scenario, verify it fails live, then invoke `/relentless` to autonomously fix the routing gap in the MCP prompt/tool-description templates.

**Architecture:** Workflow 2b exposes a confirmed structural routing bug — the phrase "Show me leads I should reach out to today" fires `leadbay_pull_leads` (discovery) instead of `leadbay_pull_followups` (Monitor). `/relentless` uses `/eval` as its test harness, reads `.context/evals/<latest>.json` for pass/fail signal, edits `.md.tmpl` templates, rebuilds with `pnpm prompts:build`, and loops until 2b passes without regressing workflows 1/3/5.

**Tech Stack:** WORKFLOWS.md (eval contracts), promptforge `.md.tmpl` templates, `pnpm prompts:build` (assembler), `/eval` skill (test harness), `/relentless` skill (outer loop).

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `WORKFLOWS.md` | Modify | Add workflow 2b table row + contract blocks |
| `packages/promptforge/tool-descriptions/composite/pull-leads.md.tmpl` | Modify (by relentless) | Add anti-triggers for "reach out to" phrasing class |
| `packages/promptforge/tool-descriptions/composite/pull-followups.md.tmpl` | Modify (by relentless) | Add triggers for "reach out to", "get back to", "contact today" |
| `packages/promptforge/prompts/leadbay_followup_check_in.md.tmpl` | Modify (by relentless, tertiary) | Strengthen trigger phrase list if tool descriptions insufficient |
| `packages/mcp/src/prompts.generated.ts` | Auto-generated | Rebuilt by `pnpm prompts:build` — do not edit directly |
| `packages/core/src/tool-descriptions.generated.ts` | Auto-generated | Rebuilt by `pnpm prompts:build` — do not edit directly |

---

## Task 1: Add workflow 2b to WORKFLOWS.md

**Files:**
- Modify: `WORKFLOWS.md` (table row at line 16, contract block after line 75)

- [ ] **Step 1: Add table row for workflow 2b**

In the `## Supported today` table, add after the workflow 2 row (line 16):

```markdown
| 2b | **Follow-up routing (reach-out phrasing)** — "reach out to today" currently misfires to `leadbay_pull_leads` | `leadbay_followup_check_in` | "Show me leads I should reach out to today" |
```

- [ ] **Step 2: Add contract blocks after workflow 2's scenario block**

After the closing triple-backtick of workflow 2's `yaml scenario` block (currently ends around line 75), insert:

````markdown
```yaml expected
workflow_name: Follow-up routing (reach-out phrasing)
prompt_name: leadbay_followup_check_in
required_calls:
  - leadbay_pull_followups
forbidden_calls:
  - leadbay_pull_leads
  - leadbay_report_outreach
success_criteria:
  - "called leadbay_pull_followups (NOT leadbay_pull_leads) — re-engagement intent, not discovery"
  - "did NOT call leadbay_pull_leads"
  - "rendered the follow-up table with status badges (not a score-bar discovery table)"
  - "did NOT call leadbay_report_outreach"
```

```yaml scenario
prompt: "Show me leads I should reach out to today"
```
````

- [ ] **Step 3: Verify the contract blocks are parseable by /eval**

```bash
grep -A 20 "Follow-up routing (reach-out" WORKFLOWS.md
```

Expected: shows the `yaml expected` block with `workflow_name`, `required_calls`, `forbidden_calls`, `success_criteria`, and the `yaml scenario` block with the prompt.

- [ ] **Step 4: Commit**

```bash
git add WORKFLOWS.md
git commit -m "eval: add workflow 2b — routing stress-test for reach-out phrasing

'Show me leads I should reach out to today' reliably misfires to
leadbay_pull_leads. Confirmed structural gap: pull_leads triggers on
'show me leads' + 'today'; pull_followups has no matching trigger for
'reach out to'. Used as the relentless loop's target failure."
```

---

## Task 2: Verify workflow 2b fails live

**Files:** none — read-only verification

This task confirms the failure is real before wiring up relentless. Do NOT skip it — if 2b already passes, the scenario prompt needs to be harder.

- [ ] **Step 1: Run workflow 2b eval**

Invoke the eval skill:
```
/eval --workflow 2b
```

Wait for it to complete. It will write a result to `.context/evals/<timestamp>.json`.

- [ ] **Step 2: Confirm it failed on the routing invariant**

```bash
LATEST=$(ls -t .context/evals/*.json | head -1)
jq '.entries[0].passed' "$LATEST"
jq '.entries[0].evidence.tool_calls[].name' "$LATEST"
```

Expected:
- `passed`: `false`
- `tool_calls`: contains `leadbay_pull_leads`, does NOT contain `leadbay_pull_followups`

If `passed` is `true` or `leadbay_pull_followups` appears in tool_calls: the scenario is too easy. Update the prompt in WORKFLOWS.md to something harder (e.g., `"Show me today's top leads to contact"`) and re-run. Do not proceed to Task 3 until 2b reliably fails.

- [ ] **Step 3: Note the judge's failure reasoning**

```bash
jq '.entries[0].evidence.judge_reasoning' "$LATEST"
jq '[.entries[0].evidence.per_criterion[] | select(.pass == false)]' "$LATEST"
```

Save this output mentally — relentless will use it as its starting diagnosis.

---

## Task 3: Establish regression baseline for workflows 1, 3, 5

**Files:** none — read-only verification

- [ ] **Step 1: Run regression baseline**

```
/eval --workflow 1,3,5
```

- [ ] **Step 2: Confirm all three pass**

```bash
LATEST=$(ls -t .context/evals/*.json | head -1)
jq '.entries[].passed' "$LATEST"
```

Expected: three `true` values. If any fail, investigate before starting the relentless loop — a pre-existing failure would pollute the regression signal.

---

## Task 4: Invoke /relentless to fix the routing gap

**Files:**
- Relentless will edit (in order of attempt): `pull-leads.md.tmpl`, `pull-followups.md.tmpl`, `leadbay_followup_check_in.md.tmpl`
- Relentless will rebuild: `packages/mcp/src/prompts.generated.ts`, `packages/core/src/tool-descriptions.generated.ts`

- [ ] **Step 1: Invoke /relentless with the seeded mission**

```
/relentless --feature "Fix workflow 2b routing: the phrase 'Show me leads I should reach out to today' fires leadbay_pull_leads (discovery) instead of leadbay_pull_followups (Monitor re-engagement).

Root cause confirmed: pull_leads routing triggers on 'show me leads' + 'today'; pull_followups has no trigger for 'reach out to'. pull_leads has no anti-trigger for 'reach out to'.

Fix targets (in order):
1. PRIMARY: packages/promptforge/tool-descriptions/composite/pull-leads.md.tmpl — add anti_triggers for 'reach out to', 'get back to', 'contact today', 'should I contact'
2. SECONDARY: packages/promptforge/tool-descriptions/composite/pull-followups.md.tmpl — add triggers for the same phrasing class
3. TERTIARY: packages/promptforge/prompts/leadbay_followup_check_in.md.tmpl — strengthen trigger phrase list

Build gate: run 'pnpm prompts:build' from the repo root after every template edit. It must exit 0 before re-eval.

Test harness: invoke /eval skill with '--workflow 2b' after each build. Read .context/evals/<latest>.json:
  jq '.entries[0].passed'                                              # must become true
  jq '.entries[0].evidence.tool_calls[].name'                         # must contain leadbay_pull_followups, not leadbay_pull_leads
  jq '[.entries[0].evidence.per_criterion[] | select(.pass==false)]'  # must be empty

Regression guard: once 2b passes, invoke /eval skill with '--workflow 1,3,5'. All three must remain true.
  jq '.entries[].passed'   # all three must be true

Do NOT narrow the fix to just this exact phrase — improve the whole 'reach out / contact / get back to / re-engage' phrasing class so the routing is genuinely more robust.

Criteria ratchet: never relax a success criterion to make a test pass. Criteria can only get tighter.

Milan Check: PASS only when 2b passes (mission_match >= 4) AND workflows 1/3/5 all still pass AND a second-opinion fresh-context judge confirms the template diff is a genuine routing improvement, not a narrow hack."
```

- [ ] **Step 2: Watch the loop run**

Relentless is fully autonomous — do not intervene. It will:
1. Write mission + criteria files
2. Plan which template to edit first
3. Edit → build → eval → read JSON → repeat
4. Run regression check on first 2b pass
5. Run Milan Check when stable

Expected iteration count: 3–8 (routing fixes are typically fast once the right anti-trigger is found).

- [ ] **Step 3: Review the final diff when relentless stops**

```bash
git diff HEAD~1 -- packages/promptforge/tool-descriptions/composite/pull-leads.md.tmpl
git diff HEAD~1 -- packages/promptforge/tool-descriptions/composite/pull-followups.md.tmpl
git diff HEAD~1 -- packages/promptforge/prompts/leadbay_followup_check_in.md.tmpl
```

Verify:
- The diff adds anti-triggers / triggers covering the "reach out to" phrasing class
- It does NOT remove any existing triggers or anti-triggers
- The generated files (`prompts.generated.ts`, `tool-descriptions.generated.ts`) are updated consistently

- [ ] **Step 4: Run full eval suite to confirm clean state**

```
/eval --workflow 1,3,5
```

Then:
```
/eval --workflow 2b
```

Both must show `passed: true` for all entries.

- [ ] **Step 5: Confirm relentless committed**

```bash
git log --oneline -5
```

Relentless writes a commit at the end of its Milan Check. If it didn't commit, commit manually:

```bash
git add packages/promptforge/tool-descriptions/composite/pull-leads.md.tmpl \
        packages/promptforge/tool-descriptions/composite/pull-followups.md.tmpl \
        packages/mcp/src/prompts.generated.ts \
        packages/core/src/tool-descriptions.generated.ts
git commit -m "fix(routing): pull_followups now claims reach-out/contact/get-back-to phrasing

Workflow 2b stress-test revealed pull_leads was firing for 'Show me leads
I should reach out to today' because pull_followups had no trigger for
this phrasing class. Fixed by relentless eval loop after N iterations."
```

---

## Self-Review

**Spec coverage check:**
- [x] Add workflow 2b to WORKFLOWS.md → Task 1
- [x] Verify 2b fails live before loop starts → Task 2
- [x] Establish regression baseline → Task 3
- [x] Invoke relentless with full mission seed → Task 4, Step 1
- [x] Watch loop, review diff, confirm commit → Task 4, Steps 2-5
- [x] Edit targets documented in order (pull-leads → pull-followups → prompt) → Task 4 mission string
- [x] Build gate (`pnpm prompts:build`) in mission string → Task 4
- [x] Regression guard (`/eval --workflow 1,3,5`) in mission string → Task 4
- [x] Milan Check criteria in mission string → Task 4

**Placeholder scan:** No TBDs, no "implement later", no missing code. All bash commands are exact with expected output.

**Type consistency:** No types defined — this is a config/template plan. All file paths are exact and consistent across tasks.
