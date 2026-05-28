# Release runbook

All releases are tag-driven. **Never run `npm publish` locally.** The GitHub Actions workflow in `.github/workflows/release.yml` owns publishing, and it verifies tag ↔ version agreement before each publish.

## One-time setup (already done, but for the record)

Repo secrets (Settings → Secrets and variables → Actions):

- `NPM_TOKEN` — npm automation token with publish rights on the `@leadbay` scope.

npm scope: `@leadbay` must exist with publish rights for the NPM_TOKEN holder (create at <https://www.npmjs.com/org/create> if not yet).

## Release `@leadbay/mcp`

1. On a branch, bump `packages/mcp/package.json#version` (e.g. `0.2.0` → `0.3.0`).
2. Add a note to `packages/mcp/CHANGELOG.md`.
3. PR → `main`, land.
4. Tag the merge commit and push:
   ```bash
   git checkout main && git pull
   git tag mcp-v0.3.0
   git push origin mcp-v0.3.0
   ```
5. Watch the `release` workflow in Actions. It runs `preflight-npm` → `publish-mcp` (build + test + tag/version check + `npm publish --access public --provenance`).

## Manual dry run

Actions → `release` → "Run workflow" → `package: mcp`, set `dry_run: true`. The npm half runs `npm publish --dry-run`.

## Debugging a failed release

- **`E404 Scope not found`** from `preflight-npm` → `@leadbay` org doesn't exist yet. Create at <https://www.npmjs.com/org/create>. Re-run the workflow from the Actions UI (no re-tag needed).
- **`E403`** from `publish-mcp` → token lacks publish rights on the scope. Regenerate the automation token with scope-owner rights, update `NPM_TOKEN`, re-run.
- **"Version drift: tag=X pkg=Y"** → bump `packages/mcp/package.json` in a new PR, tag the new commit.

## No automatic version bumping, no changesets

Versioning is manual — the cost of getting it wrong is a red CI run, not a wrong release. Two packages at this scale doesn't justify automation overhead. Revisit if the package count grows.
