# Task Memory: task_05.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Consolidate the release cut, four native builds, self-checks, and GitHub Release
  asset attachment in `.github/workflows/release.yml`; npm publishing remains out
  of scope until task 08.

## Important Decisions

- The manual fallback targets an already-created GitHub Release, checks that none
  of the five expected assets exist, and only then exposes the same downstream
  outputs as an automated release. This prevents duplicate asset publication.
- Follow task 05's explicit permission contract (`contents: write` only) even
  though upstream release-please examples commonly grant additional PR scopes.

## Learnings

- `actionlint` no longer recognizes the inherited `macos-13` label, and the
  runner-images catalog marks `macos-14` deprecated. The native macOS matrix now
  uses `macos-15` for arm64 and `macos-15-intel` for x64.

## Files / Surfaces

- `.github/workflows/release.yml`
- `test/releaseWorkflow.test.ts`

## Errors / Corrections

- Replaced the retired/deprecated inherited macOS runner labels after `actionlint`
  rejected `macos-13`.

## Ready for Next Run

- Task 08 can add npm/OIDC publishing after the existing `attach` job while
  preserving the `release_please` outputs and exact downstream release gate.
- Local workflow checks, the full suite, coverage, host build, and host artifact
  self-check are green; real Release creation/asset attachment remains the
  documented CI-observable acceptance on the next release PR merge.
- Implementation is committed locally as `93c71ce` (`ci: consolidate native
  release workflow`); task tracking and workflow-memory files were intentionally
  kept out of that commit.
