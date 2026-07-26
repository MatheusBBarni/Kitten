# Task Memory: task_01.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Define the shared plain-JSON supervision, review-evidence, prompt-submission, approval, and stable-error contracts without registering new RPC endpoints.
- Add boundary, limit, serialization, and backward-compatibility coverage required by task 01.

## Important Decisions

- Keep production endpoint names out of `DesktopRpcSchema` until corresponding host handlers exist.
- Encode the 2,000-file and 64 KiB decoded-chunk limits in shared constants and runtime contract validation.
- Keep error payloads content-free: stable codes, recovery hints, identities, and versions only.
- Permit opaque `worktreeBindingId` values across RPC while continuing to reject worktree objects and paths.

## Learnings

- The current shared validator enforces generic JSON shape and privileged-key rejection but has no contract-specific limit or enum validation.
- Existing bootstrap, board, inspector, and Settings envelopes already share the generic projection validator and must remain unchanged.
- `src/shared/rpc.ts` reaches 100% function and line coverage with the new contract tests.
- The full coverage run reports 91.55% functions and 92.36% lines overall but exits non-zero because unchanged files remain below the configured per-file 80% threshold.

## Files / Surfaces

- Touched: `packages/desktop/src/shared/rpc.ts`
- Touched: `packages/desktop/test/desktopShell.test.ts`

## Errors / Corrections

- Preserve the existing unrelated untracked worktree state reported by Git.
- Bun 1.3.13 rejected `bun --cwd packages/desktop run typecheck`; run package scripts from `packages/desktop` instead.
- A missing-evidence test initially used an explicit `undefined`, which correctly failed the generic JSON boundary first; the fixture now omits the field to exercise request-changes semantics.
- Final `bun run verify` passes typecheck and all 214 tests, then exits 1 at inherited per-file coverage failures outside the two touched source/test files.

## Ready for Next Run

- Contract implementation and focused/self-review evidence are present.
- `bun run test:rpc` passes 23 tests; `bun run test:acceptance` passes; `bun run build` passes.
- Task status and checkboxes remain pending, and no commit was created, because clean repository verification is required before tracking completion or auto-commit.
