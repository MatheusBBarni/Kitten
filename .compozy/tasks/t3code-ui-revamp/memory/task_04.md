# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Implement the host-owned canonical review-evidence service: registered-worktree capture,
  immutable atomic persistence, fresh fail-closed revalidation, and bounded UTF-8 chunk reads.

## Important Decisions

- Preserve the uncommitted Task 01-03 prerequisite diff and layer Task 04 only on the
  evidence service/test surfaces plus the narrow transaction seam if required.
- Derive evidence IDs from the canonical digest, capture the same worktree twice before
  the SQLite transaction, and recheck card, attempt, and exact binding projection inside
  `EventJournal.immediate`.
- Canonical text patches normalize line endings and neutralize Git-derived `index`
  blob IDs so CRLF/LF-equivalent content hashes identically while modes, paths, hunks,
  rename/delete semantics, and final-newline markers remain bound.

## Learnings

- `reviewEvidencePersistence.ts` and the `EventJournal.immediate` enlistment seam already
  exist from Task 03; the host capture/revalidation service does not yet exist.
- This Bun CLI rejects `bun --cwd packages/desktop run <script>` ordering in this
  environment; use the repository-supported package script invocation that executes the
  same gate.
- The Task 04 focused suite exercises real managed-worktree-shaped Git fixtures and
  reports 97.01% function and 99.79% line coverage for `reviewEvidence.ts`.
- The repository-wide `rtk bun run typecheck && rtk bun test` gate is green with
  3,372 passing tests, five credentialed/native probes skipped, and zero failures.
- The Electrobun package build and Compozy packet validation are green.

## Files / Surfaces

- `.compozy/tasks/t3code-ui-revamp/memory/task_04.md`
- `packages/desktop/src/host/reviewEvidence.ts`
- `packages/desktop/src/host/reviewEvidence.test.ts`

## Errors / Corrections

- The first desktop typecheck probe printed Bun usage because of unsupported `--cwd`
  placement; no source change was made from that probe.
- Self-review found that raw Git `index old..new` blob IDs would defeat CRLF/LF
  equivalence; canonicalization now neutralizes only those derived IDs.
- Desktop `bun run verify` reaches a green typecheck, acceptance suite, and 241-test
  coverage run, but exits non-zero on inherited per-file coverage thresholds in
  unrelated host and renderer files. Task 04's file is above the required 80% target.

## Ready for Next Run

- Keep `task_04.md` pending and do not create the automatic commit until the inherited
  desktop per-file coverage gate is repaired or explicitly waived; broadening Task 04
  into those unrelated files would violate the task boundary.
