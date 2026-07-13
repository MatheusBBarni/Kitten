# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add and test a GitHub Actions check that enforces the task's Conventional-Commit PR-title contract, plus document the squash-merge prerequisite.

## Important Decisions

- Pin `amannn/action-semantic-pull-request` to the specific `v6.1.1` release, matching the repository's version-tag workflow style while avoiding a floating major tag.
- Configure an explicit three-field `headerPattern` whose optional non-capturing `!` accepts breaking-change titles without changing `type, scope, subject` correspondence.

## Learnings

- Context7 has no entry for the semantic PR action; the upstream repository documents native `!` support, the squash-title setting, and `v6.1.1` as the current specific release. The tag resolves upstream.
- Bun 1.3.13's built-in `YAML.parse` is sufficient for a dependency-free workflow contract test.

## Files / Surfaces

- `.github/workflows/pr-title.yml`: new PR-title check and Conventional Commit contract.
- `test/prTitleWorkflow.test.ts`: YAML, trigger, type, breaking-marker, acceptance-example, and version-pin coverage.
- `README.md`: squash-merge and PR-title prerequisite.

## Errors / Corrections

- None.

## Ready for Next Run

- Focused evidence: `rtk bun test test/prTitleWorkflow.test.ts` passed 4 tests with 0 failures.
- Full gate: `rtk bun run typecheck && rtk bun test` passed with 1,512 tests, 2 expected skips, and 0 failures.
- Post-verification self-review and `git diff --check` passed; no commitlint, Husky, dependency, or unrelated source changes were introduced.
- Implementation committed locally as `43b4986` (`ci: enforce conventional PR titles`); task tracking and workflow memory remain unstaged by design.
