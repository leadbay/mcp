# Agent evaluations

Tests are data. Agents choose how to exercise the product and inspect evidence.
There is no TypeScript eval package, scenario callback, or reusable test-script library.

```text
request.md ──────────────→ actual product session
scenario.yaml ───────────→ testing agent / user simulator
                                 │ disposable commands, original execution log
                                 ▼
independent host + backend observations ──→ fresh verifier ← acceptance.yaml
                                                │
                                      verdict + evidence citations
                                                ▼
                                 schema / completeness / hash gate
```

## Author a journey

Create one directory under `cases/` containing exactly these files:

| File | Author writes | Visible to |
|---|---|---|
| `scenario.yaml` | Initial conditions, user decisions, variants, immutable dataset references | Operator and testing agent |
| `request.md` | The user's initial request, in prose | Product assistant |
| `acceptance.yaml` | Required outcomes, prohibited effects, evidence declarations | Operator and verifier |

See [the author rules](AGENTS.md) and [the schema](../.github/evals/contracts.schema.json).
All nested objects reject unknown keys. Evidence IDs must resolve; every declaration
must be used. YAML duplicates, tags and aliases are rejected. Executable files,
symlinks, code fences, callbacks and command fields have no place in a case.
Prose can still contain unwanted instructions: author review and the execution
policy complement format validation; an extension allowlist is not a semantic
security guarantee.

Initial conditions are obligations to establish and observe, not pretend HTTP
responses. User decisions describe what the user chooses; they do not prescribe
which tool the product calls. Acceptance describes facts to prove. Explicit tool
requirements are reserved for existing routing/wire regressions. Other valid
solutions remain acceptable. A new case must not change the infrastructure.

The initial corpus migrates 15 journey scenarios and eight delivery-routing cases.
It preserves pending imports, ambiguous taxonomy, computing lenses, returned order,
paid consent, tour exits, country scope and researched versus unknown signals.
The old fixture response objects and numeric aggregate grader are retired.
Source-grep tests for that retired runner are retired with it; the independent
client-region behavior assertions remain unit tests. Existing product unit and
integration tests continue to use the repository's ordinary tooling.

## Validate definitions

```sh
pnpm test:eval
```

This builds a pinned generic agent image and runs the exact CI contract validation
step without network access or LLM credentials. It validates definitions, not
product behavior. CI additionally exercises both containers' real filesystem
permissions. Its success must never be reported as passing live journeys.

The old `test:gate`, `test:periodic`, `eval:drift` and `EVAL=1` entrypoints are
removed. Select cases and repetitions as run inputs, not another test language.

## Execute a journey

The operator is a human or an agent outside the test container. The operator
prepares the dedicated tenant, supplies the actual product connection, captures
original evidence and seals the run. These are prerequisites, not built-in mock
backend capabilities. The backend in this repository has no tenant-reset service.

1. Validate the case. Make an external, immutable snapshot of its three files.
   Record their SHA-256 digests before execution. Select the actual region,
   language, host, product revision, subject model and scenario variant; do not
   silently pick whichever environment happens to be available. With no selected
   variant, use the base case. Materialize any pinned external datasets outside
   Git, verify their digests, and sanitize before providing user-visible inputs.
2. Prepare a dedicated test tenant with the declared state. Record independent
   before-state evidence and configure backend-enforced test credit limits. Use
   test accounts only, including for zero-spend scenarios: a regression may
   attempt a charge. Never make customer accounts the fault-injection environment.
   Establish an independent MCP/host recorder and backend observer before the
   subject session. The testing agent receives no observer or grading credentials.
3. Supply two files in an external connection directory. `target.md` identifies
   the host, exact subject model, candidate MCP revision, tenant, region, selected
   variant and any actual host access instructions. `mcp.json` is the subject's
   standard MCP configuration for the dedicated candidate server. Keep secrets
   here, outside Git. Do not supply a repository checkout or grading artifacts.
   A CLI run covers `claude-code`; it does not cover Claude or ChatGPT UI. Those
   targets need an actual host connection. If unavailable, record the run as
   incomplete, never reinterpret it as API coverage.
4. Run the tester container, recording stdout and stderr from outside it. It can
   improvise conversation mechanics and scratch scripts. Its root filesystem and
   the selected public test files are read-only. Acceptance, the repo, observed
   evidence and verifier output are not mounted. Scratch disappears with the
   container; commands and script contents remain in the captured execution log.
5. After the tester stops, reconcile pending jobs and capture independent final
   state and billing observations. Freeze original records under `observed/`.
   Keep the raw execution stream under `execution/`; an agent-written summary is
   not original state evidence. Write `run.yaml` using `$defs.run`, recording
   actual process exit codes, definition hashes, product identity and original
   source file hashes/kinds. Keep any missing evidence missing, rather than
   creating a reassuring placeholder. Reserve verifier_exit_code as a nonzero
   value until the verifier actually exits successfully.
6. Start the separate verifier. It sees read-only criteria and frozen evidence,
   gets no product connection, and can write only scratch and its output folder.
   Retain its execution stream separately. Copy its `verdict.yaml` into the bundle
   after exit and update the actual verifier exit code. Gate the bundle with the
   same validator. Do not let either agent run the final gate with changed inputs.

The existing Claude CLI is the generic executor, not a reimplementation of the
product's agent loop. Its model is independent of the subject model. Pin both
executor and verifier models explicitly; there is no silent fallback. The default
$10 budget applies to each outer agent; it does not cap child sessions or backend
spending. The operator must set those separate provider/backend limits.

The operator steps above are implemented once, in `.github/evals/journey.py`.
It logs in to the declared tenant, snapshots identity, lenses, Monitor and quota
before and after, records every MCP request and response and every backend call
outside both sandboxes, runs the tester, seals `run.yaml`, runs the verifier,
copies the verdict and runs the exact CI gate on the bundle. Exit code 0 means
the bundle passed. `.github/evals/lane.py` runs a list of cases one tenant at a
time with verifiers in a small pool and prints a summary table.

```sh
export LEADBAY_EMAIL=... LEADBAY_PASSWORD=...          # dedicated test tenant
export ANTHROPIC_API_KEY=...                            # or CLAUDE_CODE_OAUTH_TOKEN + EVAL_CLAUDE_CREDENTIALS
docker compose -f .github/evals/compose.yaml build contracts
python3 .github/evals/journey.py --case country-scope-writes-nothing --env prod-fr --variant foreign-country --run /tmp/runs/country-fr
python3 .github/evals/lane.py --env prod-us --cases us-wide-followups-omits-geo,scan-finds-ma-cohort --out /tmp/runs
```

`--context-file` appends operator-supplied user material to `target.md`: the
spreadsheet a request refers to, or the prior turn that must exist before a
continuation request. `--stage tester` and `--stage verifier` split the two
sandboxes so verification of one journey overlaps the next journey's tester.
Run bundles hold tenant data: keep them outside Git.

The final gate compares definition hashes against the checked-out corpus. Regrade
historical evidence against its original definition revision, not today's changed
criteria. Store sealed bundles outside Git with restricted access and retention
appropriate to the source data. PostHog/Sentry references are not full conversations;
missing history must remain explicit. Do not upload production observations in a
public CI artifact. No data is uploaded by these workflows.

## Release gate

`.github/workflows/eval-release-gate.yml` runs on every pull request and on
manual dispatch. Journeys start only when the PR changes the version in
`packages/mcp/package.json` (the file `auto-tag` reads on `main`). One job per
production tenant runs its lane serially under a per-tenant concurrency group,
so two release PRs never share before/after evidence. The `gate` job is the
required status check on `main`: it passes when no journeys were due and fails
when any bundle fails. The matrix lists only cases that have passed on the
released MCP; a case joins it once it has. Secrets: the org secret `CLAUDE_CODE_OAUTH_TOKEN`
(the one the review bot uses), `EVAL_LEADBAY_EMAIL`, `EVAL_LEADBAY_PASSWORD`. The
repository is public, so nothing is uploaded: the step summary carries criterion
ids and counts, and evidence stays on the runner.

## What makes a run pass

Every required outcome and prohibited effect has one result. Each passing result
must cite every declared evidence source, with a matching digest and a precise
location. A source's kind must match the requirement: conversation prose cannot
stand in for billing. Case identity, actual process completion and definition
hashes must match. Missing criteria, missing files, incomplete calls, unproven
state, pending side effects, changed evidence or unresolved outcomes cannot pass.

The mechanical gate verifies completeness and provenance references, not the
truth of natural-language reasoning. The operator's recorder provenance is the
trust boundary; hashes do not prove a self-authored file is an original. The
separate verifier must inspect the cited original facts. Qualify new criteria
against a known failure and a legitimate alternative before making them a release
requirement. Repeat runs keep all failures; reruns do not erase earlier results.

The infrastructure in `.github/evals/` supplies schema validation, a generic
sandbox and role instructions. Its inline Python checks formats and evidence
integrity only. It must never grow case-specific assertions or become another
maintained test implementation library.
