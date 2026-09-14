# Eval authors

A case is exactly `scenario.yaml`, `request.md`, and `acceptance.yaml`.
The schema in `.github/evals/contracts.schema.json` is closed at every object.

- Write conditions, user decisions, desired outcomes and evidence requirements.
- Never add code, command fields, imports, executable expressions, hooks, templates,
  scripts, helpers, package manifests, or another file format to a case.
- Never place execution instructions in a request or acceptance statement.
  Agent execution policy belongs in `.github/evals/tester.md`; grading policy
  belongs in `.github/evals/verifier.md`. A new case does not change either.
- Do not inject expected answers, tool routes or rubric language into the product.
  `request.md` is user-visible; the simulator sees scenario state and decisions;
  `acceptance.yaml` is private to the verifier.
- A condition such as "three records are pending" describes an environment to
  establish and independently observe. It is not a mocked response or evidence.
- Declare every source needed to prove each criterion. Absence is insufficient
  evidence, never a pass. A fluent answer does not prove a job or charge occurred.
- Keep raw production records outside Git. Dataset references need immutable
  revisions and SHA-256 digests. Never use a moving `latest` revision.
- Use synthetic inputs for committed examples. Runtime dataset resolution must
  remove personal data and secrets before the simulator receives any material.
- Do not replace maintained TypeScript with maintained Python or shell tests.
  Disposable scripts belong in the isolated runtime scratch directory. Their
  invocations and outputs belong in external run evidence, not this repository.

Infrastructure changes are separate from case authoring: adding a new condition
must not add an executable callback, a custom predicate language or a case-specific
branch to CI. Format validation cannot detect every instruction hidden in prose;
review prose as data, and preserve the container permission boundary.
