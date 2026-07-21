# Task Memory: task_01.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Define the standalone update contracts, strict pure validators, deterministic output, and a read-only XDG ownership loader without implementing installer persistence, release fetching, or executable replacement.

## Important Decisions

- The public registry boundary performs read-only positive-ownership validation and returns an explicit refusal outcome on any ambiguity; mutation and network operations are contract-only injected seams reserved for later tasks.
- Reuse `BUILD_TARGETS` and `artifactName` from `scripts/build.ts` so supported platforms and artifact names cannot drift from release production.

## Learnings

- A read-only registry loader can prove positive ownership by requiring the canonical executable path, embedded version, current file hash, and registry record to agree before later update work is allowed to proceed.
- Exact release-tag and manifest parsers are safest as closed grammars: accepting only one supported artifact row with lowercase SHA-256 data makes malformed, duplicate, traversal, stale, and ambiguous inputs ordinary refusal outcomes.
- Task-focused coverage reached 100% functions and 98.97% lines for `src/update.ts`; the repository aggregate remained above 80%, although the coverage script exits nonzero on an inherited `src/agent/transport.ts` function threshold.

## Files / Surfaces

- Added `src/update.ts`: standalone contracts, validators, read-only registry loader, deterministic outcome formatter, and injected effect boundaries.
- Added `src/update.test.ts`: 41 tests covering valid and refused primitive inputs, no-effect guarantees, and temporary-XDG registry reads.

## Errors / Corrections

- Initial focused tests passed, but typecheck exposed a non-distributive combined `refused | failed` outcome member and an intentionally invalid schema fixture. Split the outcome members and made the fixture's invalid type explicit.
- Self-review aligned public XDG and canonical-key helpers with repository ergonomics: real defaults remain available while every environment, home, and hash source is still injectable.
- `bun run test:coverage` ran 2,850 tests successfully and reported 96.53% function / 97.99% line aggregate coverage, but exited 1 because the unrelated existing `src/agent/transport.ts` function coverage is 76.47%. The required repository gate `bun run typecheck && bun test` passed cleanly.

## Ready for Next Run

- Task 01 is complete. Task 02 can persist only records accepted by this schema using the separate standalone registry path; Task 03 can consume the read-only ownership loader and injected effects without adding ACP, store, app, or UI dependencies to this boundary.
