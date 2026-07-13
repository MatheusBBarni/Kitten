# Task Memory: task_02.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Replace the installer placeholder with `MatheusBBarni/Kitten`, lead the README
  with the working checksummed curl channel, document the real launch/agent
  requirements, and enforce the documented URL contract in CI with tests.

## Important Decisions

## Learnings

- `origin` is `MatheusBBarni/Kitten`, the default branch is `main`, and the
  installer exists on remote `main`, but GitHub reports the repository as private.

## Files / Surfaces

## Errors / Corrections

- Baseline URL checks returned 404 for both the placeholder raw URL and the real
  raw URL; the real repository page also returns 404 without authentication.
- Implementation stopped before code edits because a CI check that rejects 404
  would fail the same README command the task requires us to advertise as working.

## Ready for Next Run

- Resume after the repository is public, or after the PRD explicitly defines an
  authenticated/private distribution path and corresponding CI contract.
