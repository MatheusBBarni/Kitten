# Task Memory: task_01.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Add the reducer-owned, protocol-free steering lifecycle and its exhaustive core coverage.

## Important Decisions

- Steering events use closed `steering_*` domain variants; every post-enqueue transition is fenced by the head request id and generation.
- Accepted requests remain ordered in one live queue. Confirmed delivery joins their text blocks with newlines into one normal user turn; recovery retains the exact ordered blocks until acknowledgement.
- Steering-only reducer transitions replace only `SessionState.steering`, preserving transcript and derived-field references.

## Learnings

- `AppStore.applyEvent` already routes every `DomainSessionEvent` through `sessionReducer`, so task 01 needs no store mutation.
- The run writer is an explicit whitelist snapshot and does not serialize the newly added live steering field.

## Files / Surfaces

- `src/core/types.ts`
- `src/core/steering.ts`
- `src/core/steering.test.ts`
- `src/core/sessionReducer.ts`
- `src/core/sessionReducer.test.ts`

## Errors / Corrections

- The first repository-wide gate had one unrelated OpenTUI frame timeout in `Markdown.test.tsx` after 2,430 passes; the exact failing test passed immediately in isolation, and the fresh full gate then passed all 2,431 runnable tests.

## Ready for Next Run

- Task 01 implementation and verification are complete. The lifecycle module has 100% function and line coverage, and the fresh full gate passed typecheck plus 2,431 tests with 4 credential-gated skips.
